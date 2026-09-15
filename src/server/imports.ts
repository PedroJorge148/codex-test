import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertAdmin, candidateSchema, DomainError, fail, parseCell, validateValue, type BatchInput, type Candidate, type CreateInput, type Value } from '../shared/domain.js';
import { decrypt, encrypt, hash } from './crypto.js';
import { one, query, type Actor, type Tx } from './db.js';
import { audit, createApplication, editApplications, fields, loadApplications, members, operation } from './records.js';
import type { ParsedFile } from './parse-file.js';

export const importConfigSchema = z.object({ mapping: z.record(z.string(), z.string()), source: z.string().regex(/^[a-z0-9_-]{1,50}$/), jobId: z.string().uuid().optional(), sheet: z.string().max(100).optional(), delimiter: z.enum([',', ';', '\t']).default(','), dateFormat: z.enum(['iso', 'br']).default('iso'), decimal: z.enum(['.', ',']).default('.') }).strict();
export type ImportConfig = z.infer<typeof importConfigSchema>;
interface ImportRecord { id: string; encrypted_file: string | null; format: 'csv' | 'xlsx'; schema_version: number; status: string; config: ImportConfig | null }
export interface PreparedRow { mode: 'create' | 'update'; create?: CreateInput; edit?: BatchInput; candidateExternal?: string; applicationExternal?: string; source: string }
export function parseIsolated(base64: string, format: 'csv' | 'xlsx', config?: Partial<ImportConfig>): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const isTs = import.meta.url.endsWith('.ts');
    const worker = new Worker(new URL(isTs ? './parse-file.ts' : './parse-file.js', import.meta.url), { workerData: { base64, format, ...config }, resourceLimits: { maxOldGenerationSizeMb: 128 }, execArgv: isTs ? ['--import', 'tsx'] : [] });
    const timer = setTimeout(() => { void worker.terminate(); reject(new DomainError(422, 'FILE_LIMIT', 'Tempo de leitura excedido.')); }, 15000);
    worker.once('message', (message: { result?: ParsedFile; error?: string }) => { clearTimeout(timer); void worker.terminate(); if (message.result) resolve(message.result); else reject(new DomainError(422, 'FILE_INVALID', message.error ?? 'Arquivo inválido.')); });
    worker.once('error', () => { clearTimeout(timer); reject(new DomainError(422, 'FILE_INVALID', 'Não foi possível processar o arquivo dentro dos limites.')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new DomainError(422, 'FILE_INVALID', 'Processamento interrompido.')); });
  });
}
export async function uploadImport(tx: Tx, actor: Actor, body: { filename: string; base64: string; operationId: string }, key: string): Promise<{ id: string }> {
  assertAdmin(actor.role);
  const format = body.filename.toLowerCase().endsWith('.xlsx') ? 'xlsx' : body.filename.toLowerCase().endsWith('.csv') ? 'csv' : null;
  if (!format || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64) || Buffer.from(body.base64, 'base64').length > 10 * 1024 * 1024) fail('Envie um CSV ou XLSX de até 10 MB.');
  return operation(tx, actor, body.operationId, 'import_upload', 'import', { filename: body.filename, size: body.base64.length }, async op => {
    const id = randomUUID();
    await query(tx, "insert into imports(organization_id,id,actor_id,status,format,filename,encrypted_file,schema_version) values($1,$2,$3,'uploaded',$4,$5,$6,$7)", [actor.organizationId, id, actor.userId, format, body.filename.slice(0, 200), encrypt(body.base64, key), actor.schemaVersion]);
    await audit(tx, actor, op, key, 'import', id, 'status', null, 'uploaded'); return { id };
  });
}
export async function previewFile(tx: Tx, actor: Actor, id: string, key: string, config: Partial<ImportConfig>): Promise<Omit<ParsedFile, 'rows'> & { rows: string[][]; count: number }> {
  assertAdmin(actor.role); const record = await one<ImportRecord>(tx, 'select * from imports where id=$1 and expires_at>now()', [id]);
  if (!record.encrypted_file) fail('Arquivo expirado.');
  const result = await parseIsolated(decrypt<string>(record.encrypted_file, key), record.format, config);
  return { ...result, rows: result.rows.slice(0, 20), count: result.rows.length };
}
async function external(tx: Tx, source: string, type: 'candidate' | 'application', id?: string): Promise<string | undefined> {
  if (!id) return undefined;
  return (await query<{ id: string }>(tx, `select ${type}_id as id from external_ids where source=$1 and entity_type=$2 and external_id=$3`, [source, type, id]))[0]?.id;
}
export async function prepareRow(tx: Tx, actor: Actor, cells: Record<string, string>, config: ImportConfig, operationId: string): Promise<PreparedRow> {
  const definitions = await fields(tx); const people = await members(tx, actor.organizationId);
  const values: Record<string, Value> = {}; const candidate: Record<string, string | null> = {};
  let candidateExternal: string | undefined; let applicationExternal: string | undefined; let jobId = config.jobId;
  for (const [header, target] of Object.entries(config.mapping)) {
    const text = cells[header]?.trim() ?? '';
    if (target.startsWith('field:')) {
      const field = definitions.find(f => f.id === target.slice(6) && !f.archived); if (!field) fail('Mapeamento contém campo inexistente.');
      let input = text;
      if (field.type === 'date' && config.dateFormat === 'br' && /^\d{2}\/\d{2}\/\d{4}$/.test(input)) input = input.split('/').reverse().join('-');
      if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(input)) input = input.slice(0, 10);
      if (field.type === 'number' && input) {
        const pattern = config.decimal === ',' ? /^-?\d+(,\d+)?$/ : /^-?\d+(\.\d+)?$/;
        if (!pattern.test(input)) fail('Número incompatível com o separador decimal escolhido.');
      }
      values[field.id] = parseCell(field, input, people);
    } else if (['candidate.name', 'candidate.email', 'candidate.phone'].includes(target)) candidate[target.split('.')[1]!] = text || null;
    else if (target === 'candidate.externalId') candidateExternal = text || undefined;
    else if (target === 'application.externalId') applicationExternal = text || undefined;
    else if (target === 'job.id') jobId = text || jobId;
    else if (target) fail('Destino de mapeamento desconhecido.');
  }
  if (!jobId || !z.uuid().safeParse(jobId).success) fail('Selecione uma vaga válida.');
  if ((candidateExternal?.length ?? 0) > 200 || (applicationExternal?.length ?? 0) > 200) fail('Identificador externo excede 200 caracteres.');
  const existingApp = await external(tx, config.source, 'application', applicationExternal);
  const existingCandidate = await external(tx, config.source, 'candidate', candidateExternal);
  const metadata = { candidateExternal, applicationExternal, source: config.source };
  if (existingApp) {
    const row = (await loadApplications(tx, [existingApp]))[0];
    if (!row || row.deleted_at) throw new DomainError(409, 'AMBIGUOUS', 'ID corresponde a uma candidatura excluída.');
    if (row.job_id !== jobId || (existingCandidate && existingCandidate !== row.candidate_id)) throw new DomainError(409, 'AMBIGUOUS', 'ID externo apresenta vínculos incompatíveis.');
    const edit = { id: row.id, version: row.version, candidateVersion: row.candidate.version, values, ...(Object.keys(candidate).length ? { candidate: candidateSchema.partial().parse(candidate) } : {}) };
    if (!Object.keys(values).length && !Object.keys(candidate).length) fail('Nenhum valor mapeado para atualização.');
    return { ...metadata, mode: 'update', edit: { operationId, schemaVersion: actor.schemaVersion, edits: [edit] } };
  }
  if (!existingCandidate && (candidate.email || candidate.phone)) {
    const possible = await query(tx, "select id from candidates where ($1::text is not null and lower(email)=lower($1)) or ($2::text is not null and regexp_replace(phone,'[^0-9]','','g')=regexp_replace($2,'[^0-9]','','g'))", [candidate.email ?? null, candidate.phone ?? null]);
    if (possible.length) throw new DomainError(409, 'AMBIGUOUS', 'Possível candidato duplicado. Informe um ID externo confiável.');
  }
  if (existingCandidate && Object.keys(candidate).length) {
    const current = await one<Candidate>(tx, 'select id,name,email,phone,version from candidates where id=$1 and deleted_at is null', [existingCandidate]);
    for (const [key, value] of Object.entries(candidate)) if ((key === 'email' ? value?.toLowerCase() : value) !== current[key as 'name' | 'email' | 'phone']) throw new DomainError(409, 'AMBIGUOUS', 'Os dados mapeados divergem do candidato existente. Revise o cadastro antes de vinculá-lo a outra vaga.');
  }
  return { ...metadata, mode: 'create', create: { candidateId: existingCandidate, ...(existingCandidate ? {} : { candidate: candidateSchema.parse(candidate) }), jobId, values, schemaVersion: actor.schemaVersion, operationId } };
}
export async function applyPrepared(tx: Tx, actor: Actor, row: PreparedRow, key: string): Promise<{ id: string; result: string }> {
  let id: string; let result = row.mode === 'create' ? 'created' : 'updated';
  if (row.mode === 'create' && row.create) {
    // A previous line may have introduced this external candidate since preview.
    const candidateId = await external(tx, row.source, 'candidate', row.candidateExternal);
    if (candidateId && row.create.candidate) {
      const current = await one<Candidate>(tx, 'select id,name,email,phone,version from candidates where id=$1 and deleted_at is null', [candidateId]);
      for (const field of ['name', 'email', 'phone'] as const) if ((row.create.candidate[field] ?? null) !== current[field]) throw new DomainError(409, 'AMBIGUOUS', 'Outra linha criou este candidato com dados diferentes.');
    }
    const input = candidateId ? { ...row.create, candidateId, candidate: undefined } : row.create;
    id = (await createApplication(tx, actor, input, key, 'import')).id;
  } else if (row.edit) {
    const edit = row.edit.edits[0]!; const current = (await loadApplications(tx, [edit.id]))[0];
    if (!current || current.deleted_at) throw new DomainError(409, 'VERSION_CONFLICT', 'Candidatura removida após a prévia.');
    if (current.version !== edit.version || (edit.candidate && current.candidate.version !== edit.candidateVersion)) throw new DomainError(409, 'VERSION_CONFLICT', 'Registro alterado após a prévia.');
    const definitions = await fields(tx); const people = (await members(tx, actor.organizationId)).filter(m => m.active).map(m => m.id);
    const unchanged = Object.entries(edit.values).every(([id, value]) => { const field = definitions.find(f => f.id === id && !f.archived); if (!field) fail('Campo indisponível.'); return JSON.stringify(validateValue(field, value, people, current.values[id])) === JSON.stringify(current.values[id] ?? null); }) && Object.entries(edit.candidate ?? {}).every(([name, value]) => (name === 'email' && typeof value === 'string' ? value.toLowerCase() : value) === current.candidate[name as 'name' | 'email' | 'phone']);
    if (unchanged) {
      await operation(tx, actor, row.edit.operationId, 'import_unchanged', 'import', row.edit, async () => ({ id: edit.id }));
      id = edit.id;
    } else id = (await editApplications(tx, actor, row.edit, key, 'import')).ids[0]!;
    if (unchanged) result = 'unchanged';
  }
  else fail('Linha preparada inválida.');
  const app = (await loadApplications(tx, [id]))[0]!;
  for (const [type, externalId, entityId] of [['candidate', row.candidateExternal, app.candidate_id], ['application', row.applicationExternal, id]] as const) if (externalId) {
    const found = await external(tx, row.source, type, externalId);
    if (found && found !== entityId) throw new DomainError(409, 'AMBIGUOUS', 'Identificador externo passou a apontar para outro registro.');
    await query(tx, `insert into external_ids(organization_id,source,entity_type,external_id,${type}_id) values($1,$2,$3,$4,$5) on conflict do nothing`, [actor.organizationId, row.source, type, externalId, entityId]);
  }
  return { id, result };
}
export async function validateImport(tx: Tx, actor: Actor, id: string, config: ImportConfig, key: string, chunkSize?: number): Promise<{ ready: number; invalid: number }> {
  assertAdmin(actor.role); const record = await one<ImportRecord>(tx, 'select * from imports where id=$1 and expires_at>now() for update', [id]);
  if (!['uploaded', 'ready', 'stale', 'validation_queued', 'validating'].includes(record.status) || !record.encrypted_file) fail('Importação não pode ser remapeada neste estado.');
  const file = await parseIsolated(decrypt<string>(record.encrypted_file, key), record.format, config);
  if (Object.keys(config.mapping).some(h => !file.headers.includes(h)) || new Set(Object.values(config.mapping).filter(Boolean)).size !== Object.values(config.mapping).filter(Boolean).length) fail('Mapeamento possui cabeçalho desconhecido ou destinos repetidos.');
  if (!chunkSize || record.status !== 'validating') await query(tx, 'delete from import_rows where import_id=$1', [id]);
  const previous = await query<{ identity_key: string | null; status: string }>(tx, 'select identity_key,status from import_rows where import_id=$1', [id]);
  let ready = previous.filter(r => r.status === 'ready').length; let invalid = previous.length - ready; const seen = new Set(previous.map(r => r.identity_key).filter((v): v is string => Boolean(v)));
  const start = previous.length; const end = Math.min(file.rows.length, start + (chunkSize ?? file.rows.length));
  for (let index = start; index < end; index++) {
    const row = file.rows[index]!; let identityKey: string | null = null;
    const op = randomUUID(); let prepared: PreparedRow | undefined; let error: string | null = null; let status = 'ready';
    await query(tx, 'savepoint import_preview');
    try {
      if (file.errors[index + 2]) fail(file.errors[index + 2]!);
      prepared = await prepareRow(tx, actor, Object.fromEntries(file.headers.map((h, i) => [h, row[i] ?? ''])), config, op);
      const identity = hash(prepared.applicationExternal ?? `new:${prepared.candidateExternal ?? JSON.stringify(prepared.create?.candidate)}:${prepared.create?.jobId}`);
      if (seen.has(identity)) throw new DomainError(409, 'AMBIGUOUS', 'Candidatura repetida no arquivo.');
      seen.add(identity); identityKey = identity;
      await applyPrepared(tx, actor, prepared, key); ready++;
    } catch (cause) {
      invalid++; status = cause instanceof DomainError && cause.code === 'AMBIGUOUS' ? 'ambiguous' : 'invalid';
      error = cause instanceof DomainError ? cause.message : 'Dados inválidos ou referência incompatível.';
    } finally { await query(tx, 'rollback to savepoint import_preview'); await query(tx, 'release savepoint import_preview'); }
    await query(tx, 'insert into import_rows(organization_id,import_id,row_number,status,encrypted_data,error,operation_id,identity_key) values($1,$2,$3,$4,$5,$6,$7,$8)', [actor.organizationId, id, index + 2, status, prepared ? encrypt(prepared, key) : null, error, op, identityKey]);
  }
  await query(tx, "update imports set status=$4,config=$2::jsonb,schema_version=$3 where id=$1", [id, JSON.stringify(config), actor.schemaVersion, end === file.rows.length ? 'ready' : 'validating']);
  return { ready, invalid };
}
export async function queueValidation(tx: Tx, actor: Actor, id: string, config: ImportConfig, operationId: string, key: string): Promise<{ id: string; status: string }> {
  assertAdmin(actor.role);
  return operation(tx, actor, operationId, 'import_validate', 'import', { id, config }, async op => {
    const record = await one<ImportRecord>(tx, 'select * from imports where id=$1 and expires_at>now()', [id]);
    if (!['uploaded', 'ready', 'stale', 'failed'].includes(record.status) || !record.encrypted_file) fail('Importação indisponível para validação.');
    await query(tx, 'delete from import_rows where import_id=$1', [id]);
    await query(tx, "update imports set status='validation_queued',config=$2::jsonb,schema_version=$3 where id=$1", [id, JSON.stringify(config), actor.schemaVersion]);
    await audit(tx, actor, op, key, 'import', id, 'status', record.status, 'validation_queued'); return { id, status: 'validation_queued' };
  });
}
export async function confirmImport(tx: Tx, actor: Actor, id: string, operationId: string, key: string): Promise<{ id: string }> {
  assertAdmin(actor.role);
  return operation(tx, actor, operationId, 'import_confirm', 'import', { id }, async op => {
    const record = await one<ImportRecord>(tx, 'select * from imports where id=$1 and expires_at>now() for update', [id]);
    if (record.status !== 'ready') fail('Valide o arquivo antes de confirmar.');
    if (record.schema_version !== actor.schemaVersion) throw new DomainError(409, 'SCHEMA_CONFLICT', 'As colunas mudaram. Valide o arquivo novamente.');
    await query(tx, "update imports set status='queued' where id=$1", [id]);
    await audit(tx, actor, op, key, 'import', id, 'status', 'ready', 'queued'); return { id };
  });
}

export interface CandidateSource { read(cursor?: string): Promise<{ rows: Record<string, string>[]; nextCursor?: string }> }
export class SimulatedGupySource implements CandidateSource {
  constructor(private readonly scenario: 'normal' | 'duplicate' | 'failure' = 'normal') {}
  async read(cursor?: string): Promise<{ rows: Record<string, string>[]; nextCursor?: string }> {
    if (this.scenario === 'failure') throw new Error('Falha simulada de integração.');
    const n = cursor === '2' ? 2 : 1;
    return { rows: [{ nome: `Pessoa simulada ${n}`, email: `pessoa${n}@example.test`, candidato_id: `demo-c-${n}`, candidatura_id: this.scenario === 'duplicate' ? 'demo-a-1' : `demo-a-${n}` }], nextCursor: n === 1 ? '2' : undefined };
  }
}
