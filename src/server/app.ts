import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { z } from 'zod';
import { assertAdmin, batchSchema, createSchema, DomainError, fieldSchema, querySchema } from '../shared/domain.js';
import { checkCsrf, identity, registerAuth, sendInvitation } from './auth.js';
import type { Config } from './config.js';
import { decrypt, hash, token } from './crypto.js';
import { one, query, tenant, type Actor, type DB, type Tx } from './db.js';
import { confirmImport, importConfigSchema, previewFile, queueValidation, SimulatedGupySource, uploadImport } from './imports.js';
import { audit, createApplication, deleteApplication, editApplications, fields, listApplications, loadApplications, members, operation, saveField, undoLast } from './records.js';
import { Realtime } from './realtime.js';
import { eraseCandidate } from './worker.js';

const idSchema = z.uuid();
const opSchema = z.object({ operationId: z.uuid() }).strict();
type Handler = (tx: Tx, actor: Actor, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export async function buildApp(db: DB, cfg: Config, enableRealtime = true) {
  const app = Fastify({ logger: { level: cfg.NODE_ENV === 'test' ? 'silent' : 'info' }, disableRequestLogging: true, bodyLimit: 15 * 1024 * 1024, genReqId: () => randomUUID(), requestTimeout: 120000 });
  const realtime = new Realtime(db, cfg.DATABASE_URL);
  if (enableRealtime) await realtime.start();
  app.addHook('onClose', async () => { await realtime.close(); });
  const rateLimits = new Map<string, { count: number; reset: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const now = Date.now(); const key = req.url.startsWith('/auth') ? req.ip : hash(req.headers.cookie ?? req.ip);
    if (rateLimits.size > 5000) for (const [id, value] of rateLimits) if (value.reset < now) rateLimits.delete(id);
    const entry = rateLimits.get(key); const limit = req.url.startsWith('/auth') ? 30 : 600;
    if (entry && entry.reset > now) { if (++entry.count > limit) throw new DomainError(429, 'RATE_LIMIT', 'Muitas solicitações. Aguarde um minuto.'); }
    else rateLimits.set(key, { count: 1, reset: now + 60000 });
    reply.headers({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cache-control': 'no-store', 'x-correlation-id': req.id, 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (cfg.NODE_ENV === 'production') reply.header('strict-transport-security', 'max-age=31536000');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof DomainError) return reply.status(error.status).send({ code: error.code, message: error.message, details: error.details, correlationId: req.id });
    if (error instanceof z.ZodError) return reply.status(422).send({ code: 'VALIDATION', message: 'Revise os dados informados.', details: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })), correlationId: req.id });
    const status = typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    // Never log SQL parameters, request bodies, provider errors, cookies or uploaded contents.
    app.log.error({ code: 'REQUEST_FAILED', correlationId: req.id, status });
    return reply.status(status).send({ code: 'REQUEST_FAILED', message: status === 500 ? 'Não foi possível concluir. Use o identificador de correlação ao solicitar suporte.' : 'Solicitação inválida.', correlationId: req.id });
  });
  registerAuth(app, db, cfg);
  app.get('/api/health', async () => { await query(db, 'select 1'); return { status: 'ok' }; });
  const route = (method: 'GET' | 'POST' | 'PATCH', path: string, handler: Handler, write = method !== 'GET') => {
    app.route({ method, url: `/api/v1/organizations/:organizationId${path}`, handler: async (req, reply) => {
      const auth = await identity(db, req); if (method !== 'GET') checkCsrf(req, auth, cfg);
      const orgId = idSchema.parse((req.params as Record<string, string>).organizationId);
      return tenant(db, auth.userId, auth.sessionId, orgId, (tx, actor) => handler(tx, actor, req, reply), write);
    } });
  };
  const param = (req: FastifyRequest, name = 'id') => idSchema.parse((req.params as Record<string, string>)[name]);
  route('GET', '/metadata', async (tx, actor) => ({ fields: await fields(tx), members: await members(tx, actor.organizationId), jobs: await query(tx, 'select id,title,version,deleted_at from jobs where deleted_at is null order by title'), schemaVersion: actor.schemaVersion }));
  route('POST', '/applications/query', (tx, actor, req) => listApplications(tx, actor, querySchema.parse(req.body)), false);
  route('POST', '/applications/lookup', (tx, _actor, req) => loadApplications(tx, z.object({ ids: z.array(z.uuid()).max(200) }).strict().parse(req.body).ids), false);
  route('POST', '/applications', (tx, actor, req) => createApplication(tx, actor, createSchema.parse(req.body), cfg.AUDIT_KEY));
  route('POST', '/applications/batch', (tx, actor, req) => editApplications(tx, actor, batchSchema.parse(req.body), cfg.AUDIT_KEY));
  route('POST', '/operations/:id/undo', (tx, actor, req) => undoLast(tx, actor, param(req), opSchema.parse(req.body).operationId, cfg.AUDIT_KEY));
  route('POST', '/applications/:id/lifecycle', (tx, actor, req) => {
    const body = z.object({ version: z.number().int().positive(), restore: z.boolean(), operationId: z.uuid() }).strict().parse(req.body);
    return deleteApplication(tx, actor, param(req), body.version, body.restore, body.operationId, cfg.AUDIT_KEY);
  });
  route('POST', '/fields', (tx, actor, req) => { const body = z.object({ field: fieldSchema, operationId: z.uuid() }).strict().parse(req.body); return saveField(tx, actor, body.field, body.operationId, cfg.AUDIT_KEY); });
  route('GET', '/candidates', async (tx, _actor, req) => {
    const search = z.object({ search: z.string().max(200).default('') }).parse(req.query).search;
    return query(tx, "select id,name,email,phone,version from candidates where deleted_at is null and (name ilike $1 or email ilike $1) order by name limit 30", [`%${search.replace(/[\\%_]/g, '\\$&')}%`]);
  });
  route('POST', '/jobs', (tx, actor, req) => {
    assertAdmin(actor.role); const body = z.object({ title: z.string().trim().min(1).max(200), operationId: z.uuid() }).strict().parse(req.body);
    return operation(tx, actor, body.operationId, 'create_job', 'manual', body, async op => {
      const job = await one<{ id: string; title: string }>(tx, 'insert into jobs(organization_id,title) values($1,$2) returning id,title', [actor.organizationId, body.title]);
      await audit(tx, actor, op, cfg.AUDIT_KEY, 'job', job.id, 'title', null, body.title); return job;
    });
  });
  route('POST', '/invitations', (tx, actor, req) => {
    assertAdmin(actor.role); const body = z.object({ email: z.email(), role: z.enum(['admin', 'user']), operationId: z.uuid() }).strict().parse(req.body);
    return operation(tx, actor, body.operationId, 'invite', 'manual', body, async op => {
      const invitationToken = token(); const id = randomUUID();
      await query(tx, "insert into invitations(id,organization_id,email,role,token_hash,expires_at,created_by) values($1,$2,$3,$4,$5,now()+interval '24 hours',$6)", [id, actor.organizationId, body.email.toLowerCase(), body.role, hash(invitationToken), actor.userId]);
      await sendInvitation(cfg, body.email.toLowerCase(), invitationToken);
      await audit(tx, actor, op, cfg.AUDIT_KEY, 'invitation', id, 'role', null, body.role); return { id };
    });
  });
  route('PATCH', '/members/:id', (tx, actor, req) => {
    assertAdmin(actor.role); const id = param(req); const body = z.object({ role: z.enum(['admin', 'user']), active: z.boolean(), operationId: z.uuid() }).strict().parse(req.body);
    return operation(tx, actor, body.operationId, 'membership', 'manual', { id, ...body }, async op => {
      const old = await one<{ role: string; active: boolean }>(tx, 'select role,active from memberships where organization_id=$1 and user_id=$2 for update', [actor.organizationId, id]);
      if (old.active && old.role === 'admin' && (!body.active || body.role !== 'admin')) {
        const admins = await query(tx, "select user_id from memberships where organization_id=$1 and active=true and role='admin'", [actor.organizationId]);
        if (admins.length <= 1) throw new DomainError(422, 'LAST_ADMIN', 'Mantenha ao menos um administrador ativo.');
      }
      await query(tx, 'update memberships set role=$3,active=$4 where organization_id=$1 and user_id=$2', [actor.organizationId, id, body.role, body.active]);
      await audit(tx, actor, op, cfg.AUDIT_KEY, 'membership', id, 'role', old.role, body.role); await audit(tx, actor, op, cfg.AUDIT_KEY, 'membership', id, 'active', old.active, body.active);
      if (!body.active) realtime.revoke(actor.organizationId, id); return { id };
    });
  });
  route('POST', '/imports', (tx, actor, req) => uploadImport(tx, actor, z.object({ filename: z.string().max(200), base64: z.string().max(14 * 1024 * 1024), operationId: z.uuid() }).strict().parse(req.body), cfg.AUDIT_KEY));
  route('POST', '/imports/:id/preview', (tx, actor, req) => previewFile(tx, actor, param(req), cfg.AUDIT_KEY, importConfigSchema.partial().parse(req.body)), false);
  route('POST', '/imports/:id/validate', (tx, actor, req) => {
    const { operationId, ...config } = importConfigSchema.extend({ operationId: z.uuid() }).parse(req.body);
    return queueValidation(tx, actor, param(req), config, operationId, cfg.AUDIT_KEY);
  });
  route('POST', '/imports/:id/confirm', (tx, actor, req) => confirmImport(tx, actor, param(req), opSchema.parse(req.body).operationId, cfg.AUDIT_KEY));
  route('GET', '/imports', async (tx, actor) => { assertAdmin(actor.role); return query(tx, 'select id,status,filename,created_at,finished_at from imports order by created_at desc limit 50'); });
  route('GET', '/imports/:id', async (tx, actor, req) => {
    assertAdmin(actor.role); const id = param(req); const page = z.coerce.number().int().min(1).max(100).default(1).parse((req.query as Record<string, unknown>).page);
    const record = await one<Record<string, unknown>>(tx, 'select id,status,filename,config,created_at,finished_at,expires_at from imports where id=$1', [id]);
    const summary = await query(tx, 'select status,count(*)::int as count from import_rows where import_id=$1 group by status', [id]);
    const rows = await query(tx, 'select row_number,status,error,application_id from import_rows where import_id=$1 order by row_number limit 100 offset $2', [id, (page - 1) * 100]);
    return { ...record, summary, rows, page };
  });
  route('POST', '/sources/simulated', async (tx, actor, req) => {
    assertAdmin(actor.role); const body = z.object({ scenario: z.enum(['normal', 'duplicate', 'failure']).default('normal'), operationId: z.uuid() }).strict().parse(req.body);
    const source = new SimulatedGupySource(body.scenario); const data: Record<string, string>[] = []; let cursor: string | undefined;
    do { const page = await source.read(cursor); data.push(...page.rows); cursor = page.nextCursor; } while (cursor);
    const headers = ['nome', 'email', 'candidato_id', 'candidatura_id'];
    const csv = [headers.join(','), ...data.map(row => headers.map(h => row[h]).join(','))].join('\n');
    return uploadImport(tx, actor, { filename: 'gupy-simulada.csv', base64: Buffer.from(csv).toString('base64'), operationId: body.operationId }, cfg.AUDIT_KEY);
  });
  route('POST', '/audit/query', async (tx, actor, req) => {
    assertAdmin(actor.role); const input = z.object({ entityId: z.uuid().optional(), userId: z.uuid().optional(), source: z.string().max(30).optional(), from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), page: z.number().int().min(1).default(1) }).strict().parse(req.body);
    return query(tx, `select o.id,o.actor_id,u.name as actor_name,o.action,o.source,o.correlation_id,o.created_at,count(e.id)::int as changes
      from operations o join users u on u.id=o.actor_id left join audit_events e on (e.organization_id,e.operation_id)=(o.organization_id,o.id) and e.field<>'_undo'
      where ($1::uuid is null or exists(select 1 from audit_events a where a.operation_id=o.id and a.entity_id=$1)) and ($2::uuid is null or o.actor_id=$2) and ($3::text is null or o.source=$3) and ($4::timestamptz is null or o.created_at >= $4) and ($5::timestamptz is null or o.created_at <= $5)
      group by o.organization_id,o.id,u.name order by o.created_at desc limit 50 offset $6`, [input.entityId ?? null, input.userId ?? null, input.source ?? null, input.from ?? null, input.to ?? null, (input.page - 1) * 50]);
  }, false);
  route('POST', '/audit/:id/details', async (tx, actor, req) => {
    assertAdmin(actor.role); const id = param(req); const body = opSchema.parse(req.body);
    const events = await query<{ id: string; entity: string; entity_id: string; field: string; payload: string | null }>(tx, "select id,entity,entity_id,field,payload from audit_events where operation_id=$1 and field<>'_undo'", [id]);
    await operation(tx, actor, body.operationId, 'audit_read', 'audit', { id }, async op => { await audit(tx, actor, op, cfg.AUDIT_KEY, 'operation', id, 'accessed', null, true); return { id }; });
    return events.map(({ payload, ...event }) => ({ ...event, values: payload ? decrypt(payload, cfg.AUDIT_KEY) : null }));
  });
  route('POST', '/activity', async (tx, actor, req) => {
    assertAdmin(actor.role); const body = z.object({ days: z.number().int().min(1).max(365).default(30) }).strict().parse(req.body);
    const daily = await query(tx, "select (o.created_at at time zone g.timezone)::date as day,count(*)::int as operations from operations o join organizations g on g.id=o.organization_id where o.created_at>=now()-($1::text||' days')::interval and o.action<>'audit_read' group by day order by day", [body.days]);
    const actions = await query(tx, "select action,source,count(*)::int as count from operations where created_at>=now()-($1::text||' days')::interval and action<>'audit_read' group by action,source order by count desc", [body.days]);
    const people = await query(tx, "select u.name,count(*)::int as count from operations o join users u on u.id=o.actor_id where o.created_at>=now()-($1::text||' days')::interval and action<>'audit_read' group by u.id,u.name order by count desc", [body.days]);
    return { daily, actions, people };
  }, false);
  route('POST', '/candidates/:id/export', async (tx, actor, req) => {
    assertAdmin(actor.role); const id = param(req); const body = opSchema.parse(req.body); const candidate = await one(tx, 'select id,name,email,phone,created_at,deleted_at from candidates where id=$1', [id]);
    const applications = await loadApplications(tx, (await query<{ id: string }>(tx, 'select id from applications where candidate_id=$1', [id])).map(a => a.id));
    await operation(tx, actor, body.operationId, 'export', 'privacy', { id }, async op => { await audit(tx, actor, op, cfg.AUDIT_KEY, 'candidate', id, 'exported', null, true); return { id }; });
    return { candidate, applications };
  });
  route('POST', '/candidates/:id/erase', async (tx, actor, req) => {
    assertAdmin(actor.role); const id = param(req); z.object({ confirmation: z.literal('ELIMINAR') }).strict().parse(req.body);
    await one(tx, 'select id from candidates where id=$1', [id]); await eraseCandidate(tx, actor, id, cfg.AUDIT_KEY); return { id };
  });
  app.get('/api/v1/organizations/:organizationId/events', async (req, reply) => {
    const auth = await identity(db, req); const orgId = param(req, 'organizationId');
    await tenant(db, auth.userId, auth.sessionId, orgId, async () => undefined);
    reply.hijack(); reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write('event: reconcile\ndata: {}\n\n'); realtime.add({ organizationId: orgId, userId: auth.userId, sessionId: auth.sessionId, response: reply.raw });
  });
  const webRoot = resolve('dist/web');
  app.get('/*', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/auth/')) return reply.status(404).send({ message: 'Rota não encontrada.' });
    const path = resolve(webRoot, `.${decodeURIComponent(req.url.split('?')[0]!)}`);
    if (!path.startsWith(`${webRoot}/`) && path !== webRoot) return reply.status(404).send();
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    try { const file = path === webRoot || path.endsWith('/') ? resolve(webRoot, 'index.html') : path; const data = await readFile(file); return reply.type(mime[extname(file)] ?? 'application/octet-stream').send(data); }
    catch { try { return reply.type('text/html').send(await readFile(resolve(webRoot, 'index.html'))); } catch { return reply.status(503).send({ message: 'Execute pnpm build ou abra o frontend em http://localhost:5173.' }); } }
  });
  return app;
}
