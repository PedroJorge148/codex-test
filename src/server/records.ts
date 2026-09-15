import { randomUUID } from 'node:crypto';
import { assertAdmin, candidateSchema, DomainError, fail, validateField, validateValue, type Application, type BatchInput, type Candidate, type CreateInput, type Field, type GridQuery, type Member, type Value } from '../shared/domain.js';
import { decrypt, encrypt, hash } from './crypto.js';
import { one, query, type Actor, type Tx } from './db.js';

export async function fields(tx: Tx): Promise<Field[]> { return (await query<{ definition: Field }>(tx, 'select definition from fields order by (definition->>\'position\')::int,id')).map(r => r.definition); }
export async function members(tx: Tx, org: string): Promise<Member[]> { return query<Member>(tx, 'select u.id,u.name,u.email,m.role,m.active from memberships m join users u on u.id=m.user_id where m.organization_id=$1 order by u.name', [org]); }
export async function activeMembers(tx: Tx, org: string): Promise<string[]> { return (await members(tx, org)).filter(m => m.active).map(m => m.id); }
function checkSchema(actor: Actor, version: number): void { if (actor.schemaVersion !== version) throw new DomainError(409, 'SCHEMA_CONFLICT', 'A configuração das colunas mudou. Recarregue e revise os valores.'); }
export async function operation<T>(tx: Tx, actor: Actor, key: string, action: string, source: string, body: unknown, fn: (id: string) => Promise<T>, undoable = false): Promise<T> {
  const requestHash = hash(JSON.stringify(body));
  const previous = (await query<{ actor_id: string; request_hash: string; result: T; action: string; source: string }>(tx, 'select actor_id,request_hash,result,action,source from operations where id=$1', [key]))[0];
  if (previous) {
    if (previous.actor_id !== actor.userId || previous.request_hash !== requestHash || previous.action !== action || previous.source !== source) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de operação já utilizado.');
    return previous.result;
  }
  await query(tx, 'insert into operations(organization_id,id,actor_id,session_id,action,source,correlation_id,request_hash) values($1,$2,$3,$4,$5,$6,$2,$7)', [actor.organizationId, key, actor.userId, actor.sessionId, action, source, requestHash]);
  const result = await fn(key);
  await query(tx, 'update operations set result=$2::jsonb where id=$1', [key, JSON.stringify(result)]);
  await query(tx, 'insert into outbox(organization_id,operation_id) values($1,$2)', [actor.organizationId, key]);
  if (undoable) await query(tx, 'update sessions set last_operation_id=$1 where id=$2 and user_id=$3', [key, actor.sessionId, actor.userId]);
  return result;
}
export async function audit(tx: Tx, actor: Actor, key: string, encryptionKey: string, entity: string, id: string, field: string, before: unknown, after: unknown): Promise<void> {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await query(tx, 'insert into audit_events(organization_id,operation_id,entity,entity_id,field,payload) values($1,$2,$3,$4,$5,$6)', [actor.organizationId, key, entity, id, field, encrypt({ before, after }, encryptionKey)]);
}
export async function loadApplications(tx: Tx, ids: string[]): Promise<Application[]> {
  if (!ids.length) return [];
  const rows = await query<Application>(tx, `select a.id,a.candidate_id,a.job_id,a.version,a.deleted_at,a.created_at,j.title as job_title,
    jsonb_build_object('id',c.id,'name',c.name,'email',c.email,'phone',c.phone,'version',c.version) as candidate
    from applications a join candidates c on (c.organization_id,c.id)=(a.organization_id,a.candidate_id)
    join jobs j on (j.organization_id,j.id)=(a.organization_id,a.job_id) where a.id=any($1::uuid[])`, [ids]);
  const values = await query<{ application_id: string; field_id: string; value: Value }>(tx, `select application_id,field_id,coalesce(to_jsonb(text_value),to_jsonb(number_value),to_jsonb(date_value),to_jsonb(datetime_value),to_jsonb(boolean_value),to_jsonb(option_value),to_jsonb(user_value)) as value from field_values where application_id=any($1::uuid[])
    union all select application_id,field_id,jsonb_agg(option_id order by option_id) from multi_values where application_id=any($1::uuid[]) group by application_id,field_id`, [ids]);
  return rows.map(row => ({ ...row, values: Object.fromEntries(values.filter(v => v.application_id === row.id).map(v => [v.field_id, v.value])) }));
}
const columns: Record<string, string> = { text: 'text_value', longText: 'text_value', email: 'text_value', phone: 'text_value', url: 'text_value', number: 'number_value', date: 'date_value', datetime: 'datetime_value', boolean: 'boolean_value', single: 'option_value', user: 'user_value' };
export async function writeValue(tx: Tx, actor: Actor, appId: string, field: Field, value: Value): Promise<void> {
  await query(tx, 'delete from field_values where application_id=$1 and field_id=$2', [appId, field.id]);
  await query(tx, 'delete from multi_values where application_id=$1 and field_id=$2', [appId, field.id]);
  if (value === null) return;
  if (field.type === 'multiple') {
    for (const option of value as string[]) await query(tx, 'insert into multi_values(organization_id,application_id,field_id,option_id) values($1,$2,$3,$4)', [actor.organizationId, appId, field.id, option]);
  } else {
    const column = columns[field.type]; if (!column) fail('Tipo de campo inválido.');
    await query(tx, `insert into field_values(organization_id,application_id,field_id,${column}) values($1,$2,$3,$4)`, [actor.organizationId, appId, field.id, value]);
  }
}
export async function createApplication(tx: Tx, actor: Actor, body: CreateInput, key: string, source = 'manual'): Promise<{ id: string; version: number }> {
  checkSchema(actor, body.schemaVersion);
  return operation(tx, actor, body.operationId, 'create', source, body, async op => {
    await one(tx, 'select id from jobs where id=$1 and deleted_at is null', [body.jobId]);
    if (Boolean(body.candidateId) === Boolean(body.candidate)) fail('Informe um candidato existente ou os dados de um novo candidato.');
    let candidateId = body.candidateId;
    if (candidateId) await one(tx, 'select id from candidates where id=$1 and deleted_at is null', [candidateId]);
    else {
      const candidate = candidateSchema.parse(body.candidate); candidate.email = candidate.email?.toLowerCase() ?? null;
      candidateId = randomUUID();
      await query(tx, 'insert into candidates(organization_id,id,name,email,phone) values($1,$2,$3,$4,$5)', [actor.organizationId, candidateId, candidate.name, candidate.email, candidate.phone]);
      for (const field of ['name', 'email', 'phone'] as const) await audit(tx, actor, op, key, 'candidate', candidateId, field, null, candidate[field]);
    }
    const id = randomUUID();
    await query(tx, 'insert into applications(organization_id,id,candidate_id,job_id) values($1,$2,$3,$4)', [actor.organizationId, id, candidateId, body.jobId]);
    const definitions = await fields(tx); const memberIds = await activeMembers(tx, actor.organizationId);
    for (const name of Object.keys(body.values)) if (!definitions.some(f => f.id === name && !f.archived)) fail('Campo desconhecido ou arquivado.');
    for (const field of definitions.filter(f => !f.archived)) {
      const value = validateValue(field, body.values[field.id] === undefined ? field.defaultValue : body.values[field.id], memberIds);
      await writeValue(tx, actor, id, field, value); await audit(tx, actor, op, key, 'application', id, field.id, null, value);
    }
    await audit(tx, actor, op, key, 'application', id, 'candidate_id', null, candidateId);
    await audit(tx, actor, op, key, 'application', id, 'job_id', null, body.jobId);
    return { id, version: 1 };
  });
}
export async function editApplications(tx: Tx, actor: Actor, body: BatchInput, key: string, source = 'manual', action = 'edit'): Promise<{ ids: string[]; operationId: string }> {
  checkSchema(actor, body.schemaVersion);
  if (new Set(body.edits.map(e => e.id)).size !== body.edits.length) fail('Linhas duplicadas no lote.');
  const size = body.edits.reduce((n, e) => n + Object.keys(e.values).length + Object.keys(e.candidate ?? {}).length, 0);
  if (size > 2000 || size === 0) fail('O lote deve conter de 1 a 2.000 células.');
  return operation(tx, actor, body.operationId, action, source, body, async op => {
    const rows = await loadApplications(tx, body.edits.map(e => e.id));
    const definitions = await fields(tx); const memberIds = await activeMembers(tx, actor.organizationId);
    const candidateChanges = new Map<string, { before: Candidate; after: Candidate }>();
    const reverse: BatchInput['edits'] = [];
    for (const edit of body.edits) {
      const row = rows.find(r => r.id === edit.id);
      if (!row || row.deleted_at) throw new DomainError(404, 'NOT_FOUND', 'Candidatura indisponível.');
      if (row.version !== edit.version || (edit.candidate && row.candidate.version !== edit.candidateVersion)) throw new DomainError(409, 'VERSION_CONFLICT', 'Outra pessoa alterou este registro. Revise antes de salvar.', { id: row.id, current: row });
      const undo: BatchInput['edits'][number] = { id: row.id, version: row.version + 1, values: {} };
      for (const [fieldId, raw] of Object.entries(edit.values)) {
        const field = definitions.find(f => f.id === fieldId && !f.archived); if (!field) fail('Campo desconhecido ou arquivado.');
        const value = validateValue(field, raw, memberIds, row.values[fieldId]);
        undo.values[fieldId] = row.values[fieldId] ?? null;
        await writeValue(tx, actor, row.id, field, value); await audit(tx, actor, op, key, 'application', row.id, fieldId, row.values[fieldId] ?? null, value);
      }
      // Validate the complete resulting record, not just the submitted cells.
      for (const field of definitions.filter(f => !f.archived)) validateValue(field, Object.hasOwn(edit.values, field.id) ? edit.values[field.id] : row.values[field.id], memberIds, row.values[field.id]);
      if (edit.candidate) {
        const updated = { ...row.candidate, ...candidateSchema.parse({ name: row.candidate.name, email: row.candidate.email, phone: row.candidate.phone, ...edit.candidate }) };
        updated.email = updated.email?.toLowerCase() ?? null;
        const existing = candidateChanges.get(row.candidate_id);
        if (existing && JSON.stringify(existing.after) !== JSON.stringify(updated)) fail('O mesmo candidato recebeu valores diferentes no lote.');
        candidateChanges.set(row.candidate_id, { before: row.candidate, after: updated });
        undo.candidateVersion = row.candidate.version + 1;
        undo.candidate = { name: row.candidate.name, email: row.candidate.email, phone: row.candidate.phone };
      }
      await query(tx, 'update applications set version=version+1 where id=$1', [row.id]); reverse.push(undo);
    }
    for (const [id, change] of candidateChanges) {
      await query(tx, 'update candidates set name=$2,email=$3,phone=$4,version=version+1 where id=$1', [id, change.after.name, change.after.email, change.after.phone]);
      for (const field of ['name', 'email', 'phone'] as const) await audit(tx, actor, op, key, 'candidate', id, field, change.before[field], change.after[field]);
    }
    if (action === 'edit' && source === 'manual') await audit(tx, actor, op, key, 'operation', op, '_undo', null, reverse);
    return { ids: body.edits.map(e => e.id), operationId: op };
  }, action === 'edit' && source === 'manual');
}
export async function undoLast(tx: Tx, actor: Actor, id: string, operationId: string, key: string): Promise<{ ids: string[]; operationId: string }> {
  const session = await one<{ last_operation_id: string | null }>(tx, 'select last_operation_id from sessions where id=$1 and user_id=$2', [actor.sessionId, actor.userId]);
  if (session.last_operation_id !== id) throw new DomainError(409, 'UNDO_UNAVAILABLE', 'Esta operação não pode mais ser desfeita nesta sessão.');
  const event = await one<{ payload: string | null }>(tx, `select e.payload from audit_events e join operations o on (o.organization_id,o.id)=(e.organization_id,e.operation_id) where o.id=$1 and o.actor_id=$2 and o.session_id=$3 and e.field='_undo'`, [id, actor.userId, actor.sessionId]);
  if (!event.payload) throw new DomainError(409, 'UNDO_UNAVAILABLE', 'Valores anteriores indisponíveis.');
  const edits = decrypt<{ after: BatchInput['edits'] }>(event.payload, key).after;
  const result = await editApplications(tx, actor, { operationId, schemaVersion: actor.schemaVersion, edits }, key, 'manual', 'undo');
  await query(tx, 'update sessions set last_operation_id=null where id=$1', [actor.sessionId]); return result;
}
export async function deleteApplication(tx: Tx, actor: Actor, id: string, version: number, restore: boolean, operationId: string, key: string): Promise<{ id: string }> {
  assertAdmin(actor.role);
  return operation(tx, actor, operationId, restore ? 'restore' : 'delete', 'manual', { id, version, restore }, async op => {
    const row = (await loadApplications(tx, [id]))[0]; if (!row) throw new DomainError(404, 'NOT_FOUND', 'Registro não encontrado.');
    if (row.version !== version) throw new DomainError(409, 'VERSION_CONFLICT', 'O registro foi alterado.');
    if (restore) {
      await one(tx, 'select id from candidates where id=$1 and deleted_at is null', [row.candidate_id]);
      await one(tx, 'select id from jobs where id=$1 and deleted_at is null', [row.job_id]);
      const memberIds = await activeMembers(tx, actor.organizationId);
      for (const field of (await fields(tx)).filter(f => !f.archived)) validateValue(field, row.values[field.id], memberIds, row.values[field.id]);
    }
    const deletedAt = restore ? null : new Date().toISOString();
    await query(tx, 'update applications set deleted_at=$2,deleted_by=$3,version=version+1 where id=$1', [id, deletedAt, restore ? null : actor.userId]);
    await audit(tx, actor, op, key, 'application', id, 'deleted_at', row.deleted_at, deletedAt); return { id };
  });
}
export async function saveField(tx: Tx, actor: Actor, field: Field, operationId: string, key: string): Promise<Field> {
  assertAdmin(actor.role); const memberIds = await activeMembers(tx, actor.organizationId); validateField(field, memberIds);
  return operation(tx, actor, operationId, 'configure', 'manual', field, async op => {
    const old = (await fields(tx)).find(f => f.id === field.id);
    if (old && old.version !== field.version) throw new DomainError(409, 'VERSION_CONFLICT', 'A coluna foi alterada.');
    if (old && old.type !== field.type) fail('Crie outra coluna para usar um tipo diferente.');
    if (old && old.options.some(o => !field.options.some(n => n.id === o.id))) fail('Arquive opções em vez de removê-las.');
    if (!old && (await fields(tx)).length >= 100) fail('Limite de 100 campos atingido.');
    // Keyset scan bounds memory while checking all active records.
    let cursor = '00000000-0000-0000-0000-000000000000';
    if (!field.archived) for (;;) {
      const ids = await query<{ id: string }>(tx, 'select id from applications where deleted_at is null and id>$1 order by id limit 500', [cursor]);
      if (!ids.length) break;
      for (const row of await loadApplications(tx, ids.map(i => i.id))) {
        try { validateValue(field, row.values[field.id], memberIds, row.values[field.id]); }
        catch { fail('A regra é incompatível com registros existentes. Corrija os dados antes de aplicá-la.', { applicationId: row.id, fieldId: field.id }); }
      }
      cursor = ids.at(-1)!.id;
    }
    const next = { ...field, version: old ? old.version + 1 : 1 };
    await query(tx, 'insert into fields(organization_id,id,definition) values($1,$2,$3::jsonb) on conflict(organization_id,id) do update set definition=excluded.definition', [actor.organizationId, field.id, JSON.stringify(next)]);
    for (const option of next.options) await query(tx, 'insert into field_options(organization_id,field_id,id,label,archived) values($1,$2,$3,$4,$5) on conflict(organization_id,field_id,id) do update set label=excluded.label,archived=excluded.archived', [actor.organizationId, field.id, option.id, option.label, option.archived]);
    await query(tx, 'update organizations set schema_version=schema_version+1 where id=$1', [actor.organizationId]);
    await audit(tx, actor, op, key, 'field', field.id, 'definition', old ?? null, next); return next;
  });
}

export async function listApplications(tx: Tx, actor: Actor, input: GridQuery): Promise<{ rows: Application[]; total: number; fields: Field[]; schemaVersion: number }> {
  if (input.deleted) assertAdmin(actor.role);
  const definitions = await fields(tx); const args: unknown[] = [];
  const bind = (v: unknown) => { args.push(v); return `$${args.length}`; };
  const fixed: Record<string, { expression: string; type: string }> = { name: { expression: 'c.name', type: 'text' }, email: { expression: 'c.email', type: 'text' }, phone: { expression: 'c.phone', type: 'text' }, job: { expression: 'j.title', type: 'text' }, created_at: { expression: 'a.created_at', type: 'datetime' } };
  const expression = (id: string) => {
    if (fixed[id]) return fixed[id];
    const field = definitions.find(f => f.id === id && !f.archived); if (!field) fail('Campo de consulta desconhecido.');
    const fieldId = bind(field.id);
    if (field.type === 'multiple') return { expression: `(select array_agg(v.option_id::text order by v.option_id) from multi_values v where v.organization_id=a.organization_id and v.application_id=a.id and v.field_id=${fieldId})`, type: 'multiple' };
    return { expression: `(select v.${columns[field.type]} from field_values v where v.organization_id=a.organization_id and v.application_id=a.id and v.field_id=${fieldId})`, type: field.type };
  };
  const conditions = [`a.deleted_at is ${input.deleted ? 'not ' : ''}null`, 'c.deleted_at is null'];
  if (input.search) { const escaped = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`; const p = bind(escaped); conditions.push(`(c.name ilike ${p} or c.email ilike ${p} or j.title ilike ${p})`); }
  for (const filter of input.filters) {
    const expr = expression(filter.field);
    if (filter.operator === 'empty') { conditions.push(`${expr.expression} is null`); continue; }
    if (filter.value === undefined || filter.value === null) fail('Informe um valor para o filtro.');
    if (filter.operator === 'contains') {
      if (!['text', 'longText', 'email', 'phone', 'url'].includes(expr.type) || typeof filter.value !== 'string') fail('Operador de texto incompatível.');
      conditions.push(`${expr.expression} ilike ${bind(`%${filter.value.replace(/[\\%_]/g, '\\$&')}%`)}`);
    } else if (filter.operator === 'any') {
      if (expr.type !== 'multiple' || !Array.isArray(filter.value) || filter.value.some(v => !/^[0-9a-f-]{36}$/i.test(v))) fail('Filtro de seleção múltipla inválido.');
      conditions.push(`${expr.expression} && ${bind(filter.value)}::text[]`);
    } else {
      if (expr.type === 'multiple') fail('Use contém qualquer para seleção múltipla.');
      const numeric = expr.type === 'number';
      if (numeric && typeof filter.value !== 'number') fail('Filtro exige número.');
      if (expr.type === 'boolean' && typeof filter.value !== 'boolean') fail('Filtro exige booleano.');
      if (['single', 'user'].includes(expr.type) && (typeof filter.value !== 'string' || !/^[0-9a-f-]{36}$/i.test(filter.value))) fail('Filtro exige identificador válido.');
      if (['date', 'datetime'].includes(expr.type) && (typeof filter.value !== 'string' || !Number.isFinite(Date.parse(filter.value)))) fail('Data de filtro inválida.');
      if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator) && !['number', 'date', 'datetime'].includes(expr.type)) fail('Comparação incompatível com o tipo.');
      const operators = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      conditions.push(`${expr.expression} ${operators[filter.operator]} ${bind(filter.value)}`);
    }
  }
  const from = 'from applications a join candidates c on (c.organization_id,c.id)=(a.organization_id,a.candidate_id) join jobs j on (j.organization_id,j.id)=(a.organization_id,a.job_id)';
  const where = conditions.join(' and ');
  const total = await one<{ total: string }>(tx, `select count(*) as total ${from} where ${where}`, args);
  const order = input.sort.map(s => `${expression(s.field).expression} ${s.direction} nulls last`);
  if (!order.length) order.push('a.created_at desc'); order.push('a.id asc');
  const ids = await query<{ id: string }>(tx, `select a.id ${from} where ${where} order by ${order.join(',')} limit ${bind(input.pageSize)} offset ${bind((input.page - 1) * input.pageSize)}`, args);
  const rows = await loadApplications(tx, ids.map(i => i.id));
  return { rows: ids.map(i => rows.find(r => r.id === i.id)!), total: Number(total.total), fields: definitions, schemaVersion: actor.schemaVersion };
}
