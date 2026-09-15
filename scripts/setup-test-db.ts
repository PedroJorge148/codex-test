import { connect, one, query } from '../src/server/db.js';
import { migrate } from '../src/server/migrate.js';
const adminUrl = process.env.TEST_ADMIN_URL; const appUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !appUrl || !new URL(adminUrl).pathname.endsWith('_test') || !new URL(appUrl).pathname.endsWith('_test')) throw new Error('Use TEST_ADMIN_URL e TEST_DATABASE_URL apontando para um banco terminado em _test.');
const db = connect(adminUrl); const runtime = new URL(appUrl);
try {
  const exists = await query(db, 'select 1 from pg_roles where rolname=$1', [runtime.username]);
  const command = await one<{ ddl: string }>(db, `select format('${exists.length ? 'alter' : 'create'} role %I login nosuperuser nobypassrls password %L',$1::text,$2::text) as ddl`, [runtime.username, runtime.password]);
  await query(db, command.ddl);
  await migrate(adminUrl);
  const grant = await one<{ ddl: string }>(db, "select format('grant rh_runtime to %I',$1::text) as ddl", [runtime.username]); await query(db, grant.ddl);
  process.stdout.write('Banco temporário preparado com papel de aplicação restrito.\n');
} finally { await db.destroy(); }
