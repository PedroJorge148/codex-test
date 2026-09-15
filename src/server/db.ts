import pg from 'pg';
import { CompiledQuery, Kysely, PostgresDialect, type Transaction } from 'kysely';
import { DomainError } from '../shared/domain.js';
export type DB = Kysely<Record<string, never>>;
export type Tx = Transaction<Record<string, never>>;
export interface Actor { userId: string; sessionId: string; organizationId: string; role: 'admin' | 'user'; schemaVersion: number }
export function connect(url: string): DB {
  // DATE values must never pass through the host timezone.
  pg.types.setTypeParser(1082, value => value);
  return new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 }) }) });
}
export async function query<T>(db: DB | Tx, text: string, values: readonly unknown[] = []): Promise<T[]> { return (await db.executeQuery<T>(CompiledQuery.raw(text, [...values]))).rows; }
export async function one<T>(db: DB | Tx, text: string, values: readonly unknown[] = []): Promise<T> {
  const row = (await query<T>(db, text, values))[0];
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Registro não encontrado.');
  return row;
}
export async function tenant<T>(db: DB, userId: string, sessionId: string, orgId: string, fn: (tx: Tx, actor: Actor) => Promise<T>, lock = false): Promise<T> {
  return db.transaction().execute(async tx => {
    await query(tx, "select set_config('app.organization_id', $1, true), set_config('statement_timeout', '15000', true)", [orgId]);
    // Organization lock serializes schema changes with writes. Membership lock protects revocation.
    const org = await one<{ schema_version: number }>(tx, `select schema_version from organizations where id=$1 ${lock ? 'for update' : 'for share'}`, [orgId]);
    const membership = (await query<{ role: 'admin' | 'user' }>(tx, 'select role from memberships where organization_id=$1 and user_id=$2 and active=true for share', [orgId, userId]))[0];
    if (!membership) throw new DomainError(403, 'FORBIDDEN', 'Você não tem acesso a esta organização.');
    return fn(tx, { userId, sessionId, organizationId: orgId, role: membership.role, schemaVersion: org.schema_version });
  });
}
export async function verifyRuntimeRole(db: DB): Promise<void> {
  const role = await one<{ unsafe: boolean }>(db, "select (rolsuper or rolbypassrls or exists(select 1 from pg_tables where schemaname='public' and tableowner=current_user)) as unsafe from pg_roles where rolname=current_user");
  if (role.unsafe) throw new Error('DATABASE_URL deve usar um papel sem superuser, BYPASSRLS ou propriedade das tabelas.');
}
