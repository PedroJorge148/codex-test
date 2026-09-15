import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { connect, one, query, tenant, verifyRuntimeRole, type DB } from '../src/server/db.js';
import { buildApp } from '../src/server/app.js';
import { issueSession } from '../src/server/auth.js';
import { fieldSchema, type Application, type Page } from '../src/shared/domain.js';
import type { Config } from '../src/server/config.js';
import { workerTick, cleanup } from '../src/server/worker.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_ADMIN_URL);
describe.skipIf(!enabled)('API e PostgreSQL real', () => {
  let db: DB; let admin: DB; let app: FastifyInstance; let cfg: Config;
  const org = randomUUID(); const otherOrg = randomUUID(); const adminId = randomUUID(); const userId = randomUUID(); const outsiderId = randomUUID();
  const field = fieldSchema.parse({ id: randomUUID(), label: 'Pontuação', type: 'number', min: 0, max: 100 });
  let adminSession: Awaited<ReturnType<typeof issueSession>>; let userSession: Awaited<ReturnType<typeof issueSession>>; let outsiderSession: Awaited<ReturnType<typeof issueSession>>; let jobId: string;
  const op = () => randomUUID();
  function call(path: string, body?: unknown, role: 'admin' | 'user' | 'outsider' = 'admin', organization = org, method?: 'POST' | 'GET' | 'PATCH') {
    const session = role === 'admin' ? adminSession : role === 'user' ? userSession : outsiderSession;
    return app.inject({ method: method ?? (body === undefined ? 'GET' : 'POST'), url: `/api/v1/organizations/${organization}${path}`, headers: { cookie: `rh_session=${session.raw}`, origin: cfg.APP_URL, 'x-csrf-token': session.csrf, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, payload: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function create(name = 'Pessoa de teste', value = 10) {
    const response = await call('/applications', { candidate: { name, email: `${randomUUID()}@example.test`, phone: null }, jobId, values: { [field.id]: value }, schemaVersion: 2, operationId: op() });
    expect(response.statusCode, response.body).toBe(200); return response.json<{ id: string }>().id;
  }
  async function row(id: string) { const response = await call('/applications/lookup', { ids: [id] }); expect(response.statusCode, response.body).toBe(200); return response.json<Application[]>()[0]!; }
  beforeAll(async () => {
    if (!new URL(process.env.TEST_ADMIN_URL!).pathname.endsWith('_test')) throw new Error('Banco de testes deve terminar em _test.');
    db = connect(process.env.TEST_DATABASE_URL!); admin = connect(process.env.TEST_ADMIN_URL!);
    cfg = { DATABASE_URL: process.env.TEST_DATABASE_URL!, APP_URL: 'http://localhost:4173', AUDIT_KEY: 'a'.repeat(64), OIDC_ISSUER: 'http://localhost:8080/realms/rh', OIDC_CLIENT_ID: 'rh-web', OIDC_CLIENT_SECRET: 'test', KEYCLOAK_ADMIN_CLIENT_ID: 'rh-provisioner', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 0, RETENTION_APPROVED: 'false', AUTH_TEST_MODE: 'true' };
    await query(admin, 'insert into organizations(id,name) values($1,$2),($3,$4)', [org, 'Teste A', otherOrg, 'Teste B']);
    for (const [id, name, orgId, role] of [[adminId, 'Admin', org, 'admin'], [userId, 'Usuário', org, 'user'], [outsiderId, 'Externo', otherOrg, 'admin']]) {
      await query(admin, 'insert into users(id,subject,name,email) values($1,$4,$2,$3)', [id, name, `${id}@example.test`, id]);
      await query(admin, 'insert into memberships(organization_id,user_id,role) values($1,$2,$3)', [orgId, id, role]);
    }
    adminSession = await issueSession(db, adminId); userSession = await issueSession(db, userId); outsiderSession = await issueSession(db, outsiderId);
    app = await buildApp(db, cfg, false);
    const job = await call('/jobs', { title: 'Analista', operationId: op() }); expect(job.statusCode, job.body).toBe(200); jobId = job.json<{ id: string }>().id;
    const saved = await call('/fields', { field, operationId: op() }); expect(saved.statusCode, saved.body).toBe(200);
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.destroy(); });
  it('usa papel restrito e aplica RLS mesmo sem filtro explícito', async () => {
    await expect(verifyRuntimeRole(db)).resolves.toBeUndefined(); await expect(verifyRuntimeRole(admin)).rejects.toThrow();
    await create(); expect(await query(db, 'select * from candidates')).toHaveLength(0);
    await tenant(db, outsiderId, outsiderSession.id, otherOrg, async tx => { expect(await query(tx, 'select * from applications')).toHaveLength(0); });
  });
  it('recusa sessão ausente, organização alheia, CSRF e ações administrativas', async () => {
    expect((await app.inject({ url: `/api/v1/organizations/${org}/metadata` })).statusCode).toBe(401);
    expect((await call('/metadata', undefined, 'outsider')).statusCode).toBe(403);
    expect((await call('/fields', { field, operationId: op() }, 'user')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/organizations/${org}/jobs`, headers: { cookie: `rh_session=${adminSession.raw}`, origin: 'http://evil.test' }, payload: { title: 'X', operationId: op() } })).statusCode).toBe(403);
  });
  it('persiste, filtra e ordena valores no servidor com paginação', async () => {
    const id = await create('Pessoa Filtrável', 35); const response = await call('/applications/query', { filters: [{ field: field.id, operator: 'gte', value: 35 }], sort: [{ field: field.id, direction: 'desc' }], pageSize: 1 });
    expect(response.statusCode, response.body).toBe(200); const page = response.json<Page>(); expect(page.rows).toHaveLength(1); expect(page.rows[0]?.id).toBe(id); expect(page.total).toBeGreaterThan(0);
  });
  it('recusa valores inválidos sem persistir candidato ou auditoria parcial', async () => {
    const operationId = op(); const response = await call('/applications', { candidate: { name: 'Inválida' }, jobId, values: { [field.id]: 101 }, schemaVersion: 2, operationId });
    expect(response.statusCode, response.body).toBe(422); expect(await query(admin, 'select id from operations where id=$1', [operationId])).toHaveLength(0);
    expect(await query(admin, "select id from candidates where organization_id=$1 and name='Inválida'", [org])).toHaveLength(0);
  });
  it('duas gravações com a mesma versão produzem um sucesso e um conflito', async () => {
    const id = await create(); const responses = await Promise.all([20, 30].map(value => call('/applications/batch', { operationId: op(), schemaVersion: 2, edits: [{ id, version: 1, values: { [field.id]: value } }] }, 'user')));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]); expect((await row(id)).version).toBe(2);
  });
  it('lote inválido reverte todas as linhas e não publica evento', async () => {
    const a = await create(); const b = await create(); const operationId = op();
    const response = await call('/applications/batch', { operationId, schemaVersion: 2, edits: [{ id: a, version: 1, values: { [field.id]: 25 } }, { id: b, version: 1, values: { [field.id]: -1 } }] });
    expect(response.statusCode).toBe(422); expect((await row(a)).values[field.id]).toBe(10); expect(await query(admin, 'select id from outbox where operation_id=$1', [operationId])).toHaveLength(0);
  });
  it('idempotência não repete escrita nem aumenta versão', async () => {
    const id = await create(); const body = { operationId: op(), schemaVersion: 2, edits: [{ id, version: 1, values: { [field.id]: 27 } }] };
    expect((await call('/applications/batch', body)).statusCode).toBe(200); expect((await call('/applications/batch', body)).statusCode).toBe(200); expect((await row(id)).version).toBe(2);
    expect((await call('/applications/batch', { ...body, edits: [{ id, version: 2, values: { [field.id]: 28 } }] })).statusCode).toBe(409);
  });
  it('desfaz a última edição e recusa desfazer após outra sessão editar', async () => {
    const id = await create(); const editOp = op(); await call('/applications/batch', { operationId: editOp, schemaVersion: 2, edits: [{ id, version: 1, values: { [field.id]: 40 } }] });
    const undone = await call(`/operations/${editOp}/undo`, { operationId: op() }); expect(undone.statusCode, undone.body).toBe(200); expect((await row(id)).values[field.id]).toBe(10);
    const second = op(); await call('/applications/batch', { operationId: second, schemaVersion: 2, edits: [{ id, version: 3, values: { [field.id]: 20 } }] });
    await call('/applications/batch', { operationId: op(), schemaVersion: 2, edits: [{ id, version: 4, values: { [field.id]: 30 } }] }, 'user');
    expect((await call(`/operations/${second}/undo`, { operationId: op() })).statusCode).toBe(409); expect((await row(id)).values[field.id]).toBe(30);
  });
  it('exclusão lógica preserva candidato e restauração respeita versão', async () => {
    const id = await create('Exclusão'); expect((await call(`/applications/${id}/lifecycle`, { version: 1, restore: false, operationId: op() }, 'user')).statusCode).toBe(403);
    expect((await call(`/applications/${id}/lifecycle`, { version: 1, restore: false, operationId: op() })).statusCode).toBe(200);
    expect((await call('/applications/query', { search: 'Exclusão' })).json<Page>().total).toBe(0);
    expect((await row(id)).candidate.name).toBe('Exclusão'); expect((await call(`/applications/${id}/lifecycle`, { version: 2, restore: true, operationId: op() })).statusCode).toBe(200);
  });
  it('não permite remover o último administrador', async () => { expect((await call(`/members/${adminId}`, { role: 'user', active: false, operationId: op() }, 'admin', org, 'PATCH')).statusCode).toBe(422); });
  it('registra valores criptografados e audita sua consulta', async () => {
    const id = await create('Dados pessoais'); const event = await one<{ operation_id: string; payload: string }>(admin, "select operation_id,payload from audit_events where entity_id=$1 and field='job_id'", [id]); expect(event.payload).not.toContain('Dados pessoais');
    expect((await call(`/audit/${event.operation_id}/details`, { operationId: op() }, 'user')).statusCode).toBe(403);
    const requestId = op(); expect((await call(`/audit/${event.operation_id}/details`, { operationId: requestId })).statusCode).toBe(200); expect(await query(admin, "select id from operations where id=$1 and action='audit_read'", [requestId])).toHaveLength(1);
  });
  it('importa CSV, reporta inválidas e não duplica após confirmação repetida', async () => {
    const external = op(); const csv = `nome,email,id,nota\nImportada,${external}@example.test,${external},50\nInválida,b@example.test,${op()},999`;
    const uploaded = await call('/imports', { filename: 'teste.csv', base64: Buffer.from(csv).toString('base64'), operationId: op() }); expect(uploaded.statusCode, uploaded.body).toBe(200); const id = uploaded.json<{ id: string }>().id;
    const preview = await call(`/imports/${id}/preview`, {}); expect(preview.statusCode, preview.body).toBe(200);
    const result = await call(`/imports/${id}/validate`, { operationId: op(), source: 'test', jobId, mapping: { nome: 'candidate.name', email: 'candidate.email', id: 'application.externalId', nota: `field:${field.id}` } }); expect(result.statusCode, result.body).toBe(200); expect(result.json()).toEqual({ id, status: 'validation_queued' }); await workerTick(db, cfg); const validated = await call(`/imports/${id}`); expect(validated.json<{ summary: {status: string; count: number}[] }>().summary).toEqual(expect.arrayContaining([{status: 'ready', count: 1}, {status: 'invalid', count: 1}]));
    const confirmation = { operationId: op() }; expect((await call(`/imports/${id}/confirm`, confirmation)).statusCode).toBe(200); expect((await call(`/imports/${id}/confirm`, confirmation)).statusCode).toBe(200);
    await workerTick(db, cfg); const report = await call(`/imports/${id}`); expect(report.statusCode, report.body).toBe(200); expect(report.json<{ status: string }>().status).toBe('completed');
    expect((await call('/applications/query', { search: 'Importada' })).json<Page>().total).toBe(1); await workerTick(db, cfg); expect((await call('/applications/query', { search: 'Importada' })).json<Page>().total).toBe(1);
  });
  it('elimina contatos, campos e valores históricos sem remover metadados', async () => {
    const id = await create('Titular a eliminar'); const candidate = (await row(id)).candidate;
    const response = await call(`/candidates/${candidate.id}/erase`, { confirmation: 'ELIMINAR' }); expect(response.statusCode, response.body).toBe(200);
    const saved = await one<{ name: string; email: string | null }>(admin, 'select name,email from candidates where id=$1', [candidate.id]); expect(saved.name).toBe('[Dados eliminados]'); expect(saved.email).toBeNull();
    expect(await query(admin, 'select 1 from field_values where application_id=$1', [id])).toHaveLength(0);
    expect(await query(admin, "select 1 from audit_events where entity_id=$1 and field='name' and payload is not null", [candidate.id])).toHaveLength(0);
    expect((await call(`/applications/${id}/lifecycle`, { version: 2, restore: true, operationId: op() })).statusCode).toBe(404);
    await cleanup(db, cfg);
  });
  it('recusa mudanças de regra incompatíveis e referências de outra organização', async () => {
    const response = await call('/fields', { field: { ...field, max: 1 }, operationId: op() }); expect(response.statusCode).toBe(422);
    const foreignJob = await one<{ id: string }>(admin, 'insert into jobs(organization_id,title) values($1,$2) returning id', [otherOrg, 'Outra vaga']);
    const created = await call('/applications', { jobId: foreignJob.id, candidate: { name: 'Sem acesso' }, values: {}, schemaVersion: 2, operationId: op() }); expect(created.statusCode).toBe(404);
  });
  it('falha na auditoria aborta a escrita inteira', async () => {
    const id = await create(); const trigger = `fail_audit_${randomUUID().replaceAll('-', '')}`;
    await query(admin, `create function ${trigger}() returns trigger language plpgsql as $$ begin if NEW.entity_id='${id}'::uuid then raise exception 'audit unavailable'; end if; return NEW; end $$`);
    await query(admin, `create trigger ${trigger} before insert on audit_events for each row execute function ${trigger}()`);
    try { const response = await call('/applications/batch', { operationId: op(), schemaVersion: 2, edits: [{ id, version: 1, values: { [field.id]: 17 } }] }); expect(response.statusCode).toBe(500); expect((await row(id)).version).toBe(1); expect((await row(id)).values[field.id]).toBe(10); }
    finally { await query(admin, `drop trigger ${trigger} on audit_events`); await query(admin, `drop function ${trigger}()`); }
  });
  it('reimportação sem mudanças não altera versão e mudanças após prévia geram conflito', async () => {
    const externalId = op();
    async function prepare(score: number) {
      const csv = `nome,email,id,nota\nReimportação,${externalId}@example.test,${externalId},${score}`;
      const id = (await call('/imports', { filename: 'reimport.csv', base64: Buffer.from(csv).toString('base64'), operationId: op() })).json<{ id: string }>().id;
      const response = await call(`/imports/${id}/validate`, { operationId: op(), source: 'reimport', jobId, mapping: { nome: 'candidate.name', email: 'candidate.email', id: 'application.externalId', nota: `field:${field.id}` } }); expect(response.statusCode, response.body).toBe(200);
      await workerTick(db, cfg); return id;
    }
    const first = await prepare(10); await call(`/imports/${first}/confirm`, { operationId: op() }); await workerTick(db, cfg);
    const record = (await call('/applications/query', { search: externalId })).json<Page>().rows[0]!;
    const repeat = await prepare(10); await call(`/imports/${repeat}/confirm`, { operationId: op() }); await workerTick(db, cfg);
    expect((await call(`/imports/${repeat}`)).json<{ summary: { status: string; count: number }[] }>().summary).toContainEqual({ status: 'unchanged', count: 1 }); expect((await row(record.id)).version).toBe(1);
    const conflicting = await prepare(30); await call('/applications/batch', { operationId: op(), schemaVersion: 2, edits: [{ id: record.id, version: 1, values: { [field.id]: 20 } }] });
    await call(`/imports/${conflicting}/confirm`, { operationId: op() }); await workerTick(db, cfg);
    expect((await call(`/imports/${conflicting}`)).json<{ summary: { status: string; count: number }[] }>().summary).toContainEqual({ status: 'conflict', count: 1 }); expect((await row(record.id)).values[field.id]).toBe(20);
  });
  it('deduplicação atravessa lotes de validação sem mesclar automaticamente por e-mail', async () => {
    const suffix = op(); const entries = Array.from({ length: 26 }, (_, n) => `Pessoa ${n},${n}-${suffix}@example.test,id-${n}-${suffix}`); entries.push(entries[0]!);
    const id = (await call('/imports', { filename: 'duplicatas.csv', base64: Buffer.from('nome,email,id\n' + entries.join('\n')).toString('base64'), operationId: op() })).json<{ id: string }>().id;
    await call(`/imports/${id}/validate`, { operationId: op(), source: 'duplicatas', jobId, mapping: { nome: 'candidate.name', email: 'candidate.email', id: 'application.externalId' } });
    await workerTick(db, cfg); expect((await call(`/imports/${id}`)).json<{ status: string }>().status).toBe('validating');
    await workerTick(db, cfg); const report = (await call(`/imports/${id}`)).json<{ summary: {status: string; count: number}[] }>(); expect(report.summary).toContainEqual({status: 'ambiguous', count: 1}); expect(report.summary).toContainEqual({status: 'ready', count: 26});
  });
  it('retém candidaturas ativas e elimina apenas registros encerrados elegíveis', async () => {
    const id = await create('Retenção'); const active = await create('Ainda ativa'); const candidate = (await row(id)).candidate;
    await call(`/applications/${id}/lifecycle`, { version: 1, restore: false, operationId: op() });
    await query(admin, "update applications set deleted_at=now()-interval '40 days' where id=$1", [id]);
    await cleanup(db, { ...cfg, RETENTION_APPROVED: 'true', RETENTION_DAYS: 30 });
    expect((await one<{ name: string }>(admin, 'select name from candidates where id=$1', [candidate.id])).name).toBe('[Dados eliminados]');
    expect((await row(active)).candidate.name).toBe('Ainda ativa');
  });
  it('SSE entrega invalidação após commit e publicação do worker', async () => {
    const live = await buildApp(db, cfg, true); const base = await live.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const stream = await fetch(`${base}/api/v1/organizations/${org}/events`, { headers: { cookie: `rh_session=${adminSession.raw}` }, signal: abort.signal }); expect(stream.status).toBe(200); reader = stream.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('reconcile');
      const operationId = op(); await call('/jobs', { title: 'Evento de teste', operationId }); await workerTick(db, cfg);
      const deadline = setTimeout(() => abort.abort(), 5000); let text = '';
      try { while (!text.includes(operationId)) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); } expect(text).toContain(operationId); } finally { clearTimeout(deadline); }
    } finally { abort.abort(); await reader?.cancel().catch(() => undefined); await live.close(); }
  });
});
