import { randomUUID } from 'node:crypto';
import { DomainError } from '../shared/domain.js';
import { decrypt } from './crypto.js';
import { one, query, type Actor, type DB, type Tx } from './db.js';
import { applyPrepared, validateImport, type ImportConfig, type PreparedRow } from './imports.js';
import { audit, operation } from './records.js';
import type { Config } from './config.js';

export async function eraseCandidate(tx: Tx, actor: Actor, id: string, key: string): Promise<void> {
  const applications = await query<{ id: string }>(tx, 'select id from applications where candidate_id=$1', [id]);
  const ids = [id, ...applications.map(a => a.id)];
  const ops = await query<{ operation_id: string }>(tx, 'select distinct operation_id from audit_events where entity_id=any($1::uuid[])', [ids]);
  for (const entityId of [...ids, ...ops.map(o => o.operation_id)]) await query(tx, 'select redact_audit($1::uuid,null)', [entityId]);
  await query(tx, 'delete from multi_values where application_id=any($1::uuid[])', [applications.map(a => a.id)]);
  await query(tx, 'delete from field_values where application_id=any($1::uuid[])', [applications.map(a => a.id)]);
  await query(tx, 'delete from external_ids where candidate_id=$1 or application_id=any($2::uuid[])', [id, applications.map(a => a.id)]);
  await query(tx, 'update applications set deleted_at=coalesce(deleted_at,now()),deleted_by=$2,version=version+1 where candidate_id=$1', [id, actor.userId]);
  await query(tx, "update candidates set name='[Dados eliminados]',email=null,phone=null,deleted_at=coalesce(deleted_at,now()),deleted_by=$2,version=version+1 where id=$1", [id, actor.userId]);
  // Uploaded files may contain the subject in arbitrary columns; discard all temporary payloads for the tenant.
  await query(tx, "update imports set encrypted_file=null,filename='[Arquivo eliminado]',status=case when status in ('queued','running','ready','uploaded') then 'stale' else status end");
  await query(tx, 'update import_rows set encrypted_data=null');
  await query(tx, 'insert into erasure_ledger(organization_id,candidate_id) values($1,$2) on conflict do nothing', [actor.organizationId, id]);
  const op = randomUUID();
  await operation(tx, actor, op, 'erase', 'privacy', { id }, async operationId => { await audit(tx, actor, operationId, key, 'candidate', id, 'erased', false, true); return { id }; });
}
export async function workerTick(db: DB, cfg: Config): Promise<void> {
  const organizations = await query<{ id: string }>(db, 'select id from organizations');
  for (const org of organizations) {
    await db.transaction().execute(async tx => {
      await query(tx, "select set_config('app.organization_id',$1,true)", [org.id]);
      const organization = await one<{ schema_version: number }>(tx, 'select schema_version from organizations where id=$1 for update', [org.id]);
      const job = (await query<{ id: string; actor_id: string; config: ImportConfig; schema_version: number }>(tx, "select id,actor_id,config,schema_version from imports where status in ('validation_queued','validating') and expires_at>now() order by created_at limit 1 for update skip locked"))[0];
      if (!job) return;
      const member = (await query<{ role: string }>(tx, 'select role from memberships where organization_id=$1 and user_id=$2 and active=true for share', [org.id, job.actor_id]))[0];
      if (member?.role !== 'admin' || job.schema_version !== organization.schema_version) { await query(tx, "update imports set status='stale',finished_at=now() where id=$1", [job.id]); return; }
      const actor: Actor = { userId: job.actor_id, organizationId: org.id, sessionId: `import:${job.id}`, role: 'admin', schemaVersion: organization.schema_version };
      await query(tx, 'savepoint validate_chunk');
      try { await validateImport(tx, actor, job.id, job.config, cfg.AUDIT_KEY, 25); await query(tx, 'release savepoint validate_chunk'); }
      catch { await query(tx, 'rollback to savepoint validate_chunk'); await query(tx, 'release savepoint validate_chunk'); await query(tx, "update imports set status='failed',finished_at=now() where id=$1", [job.id]); }
      const status = await one<{ status: string }>(tx, 'select status from imports where id=$1', [job.id]);
      if (status.status !== 'validating') await operation(tx, actor, randomUUID(), 'import_validated', 'import', { id: job.id }, async op => { await audit(tx, actor, op, cfg.AUDIT_KEY, 'import', job.id, 'status', 'validating', status.status); return { id: job.id }; });
    });
    await db.transaction().execute(async tx => {
      await query(tx, "select set_config('app.organization_id',$1,true)", [org.id]);
      await query(tx, 'select id from organizations where id=$1 for update', [org.id]);
      const pending = await query<{ id: string; operation_id: string }>(tx, 'select id,operation_id from outbox where published_at is null order by created_at limit 100 for update skip locked');
      for (const event of pending) {
        await query(tx, "select pg_notify('rh_changes',$1)", [JSON.stringify({ organizationId: org.id, id: event.id, operationId: event.operation_id })]);
        await query(tx, 'update outbox set published_at=now() where id=$1', [event.id]);
      }
    });
    // Each line commits independently; a terminated worker safely resumes remaining rows.
    for (let n = 0; n < 10; n++) {
      const worked = await db.transaction().execute(async tx => {
        await query(tx, "select set_config('app.organization_id',$1,true)", [org.id]);
        const organization = await one<{ schema_version: number }>(tx, 'select schema_version from organizations where id=$1 for update', [org.id]);
        const job = (await query<{ id: string; actor_id: string; schema_version: number }>(tx, "select id,actor_id,schema_version from imports where status in ('queued','running') and expires_at>now() order by created_at limit 1 for update skip locked"))[0];
        if (!job) return false;
        const member = (await query<{ role: string }>(tx, 'select role from memberships where organization_id=$1 and user_id=$2 and active=true for share', [org.id, job.actor_id]))[0];
        if (member?.role !== 'admin' || job.schema_version !== organization.schema_version) { await query(tx, "update imports set status='stale',finished_at=now() where id=$1", [job.id]); return false; }
        const actor: Actor = { userId: job.actor_id, organizationId: org.id, sessionId: `import:${job.id}`, role: 'admin', schemaVersion: organization.schema_version };
        const row = (await query<{ row_number: number; encrypted_data: string | null }>(tx, "select row_number,encrypted_data from import_rows where import_id=$1 and status='ready' order by row_number limit 1 for update", [job.id]))[0];
        if (!row) {
          await query(tx, "update imports set status='completed',finished_at=now(),expires_at=now()+interval '24 hours' where id=$1", [job.id]);
          const op = randomUUID(); await operation(tx, actor, op, 'import_complete', 'import', { id: job.id }, async id => { await audit(tx, actor, id, cfg.AUDIT_KEY, 'import', job.id, 'status', 'running', 'completed'); return { id: job.id }; });
          return false;
        }
        await query(tx, "update imports set status='running' where id=$1", [job.id]);
        await query(tx, 'savepoint apply_row');
        try {
          if (!row.encrypted_data) throw new DomainError(422, 'EXPIRED', 'Dados temporários expirados.');
          const prepared = decrypt<PreparedRow>(row.encrypted_data, cfg.AUDIT_KEY);
          const result = await applyPrepared(tx, actor, prepared, cfg.AUDIT_KEY);
          await query(tx, 'update import_rows set status=$3,application_id=$4 where import_id=$1 and row_number=$2', [job.id, row.row_number, result.result, result.id]);
          await query(tx, 'release savepoint apply_row');
        } catch (error) {
          await query(tx, 'rollback to savepoint apply_row'); await query(tx, 'release savepoint apply_row');
          const status = error instanceof DomainError && error.status === 409 ? 'conflict' : 'invalid';
          await query(tx, 'update import_rows set status=$3,error=$4 where import_id=$1 and row_number=$2', [job.id, row.row_number, status, error instanceof DomainError ? error.message : 'Falha ao aplicar linha. Nenhum dado da linha foi gravado.']);
        }
        return true;
      });
      if (!worked) break;
    }
  }
}
export async function cleanup(db: DB, cfg: Config): Promise<void> {
  await query(db, 'delete from sessions where expires_at<now()'); await query(db, 'delete from login_states where expires_at<now()');
  for (const org of await query<{ id: string }>(db, 'select id from organizations')) await db.transaction().execute(async tx => {
    await query(tx, "select set_config('app.organization_id',$1,true)", [org.id]);
    const organization = await one<{ schema_version: number }>(tx, 'select schema_version from organizations where id=$1 for update', [org.id]);
    await query(tx, "update imports set encrypted_file=null,filename='[Arquivo expirado]',status=case when status in ('uploaded','ready','queued','running') then 'stale' else status end where expires_at<now()");
    await query(tx, 'update import_rows r set encrypted_data=null from imports i where (i.organization_id,i.id)=(r.organization_id,r.import_id) and i.expires_at<now()');
    await query(tx, "delete from outbox where published_at<now()-interval '7 days'");
    if (cfg.AUDIT_RETENTION_DAYS) await query(tx, "select redact_audit(null,now()-($1::text||' days')::interval)", [cfg.AUDIT_RETENTION_DAYS]);
    if (cfg.RETENTION_APPROVED === 'true' && cfg.RETENTION_DAYS) {
      const owner = (await query<{ user_id: string }>(tx, "select user_id from memberships where organization_id=$1 and active=true and role='admin' order by user_id limit 1", [org.id]))[0];
      if (owner) {
        const expired = await query<{ id: string }>(tx, `select c.id from candidates c where not exists(select 1 from erasure_ledger e where e.candidate_id=c.id)
          and not exists(select 1 from applications a where a.candidate_id=c.id and a.deleted_at is null)
          and coalesce((select max(a.deleted_at) from applications a where a.candidate_id=c.id),c.deleted_at) < now()-($1::text||' days')::interval limit 25`, [cfg.RETENTION_DAYS]);
        const actor: Actor = { organizationId: org.id, userId: owner.user_id, sessionId: 'retention-worker', role: 'admin', schemaVersion: organization.schema_version };
        for (const row of expired) await eraseCandidate(tx, actor, row.id, cfg.AUDIT_KEY);
      }
    }
  });
}
