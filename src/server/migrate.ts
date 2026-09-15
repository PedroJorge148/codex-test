import { readFile, readdir } from 'node:fs/promises';
import { connect, query } from './db.js';
export async function migrate(url: string): Promise<void> {
  const db = connect(url);
  try {
    await db.transaction().execute(async tx => {
      await query(tx, "select pg_advisory_xact_lock(710032)");
      await query(tx, 'create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default now())');
      const directory = new URL('../../migrations/', import.meta.url);
      for (const filename of (await readdir(directory)).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
        const name = filename.slice(0, -4);
        const done = await query(tx, 'select name from schema_migrations where name=$1', [name]);
        if (!done.length) {
          await query(tx, await readFile(new URL(filename, directory), 'utf8'));
          await query(tx, 'insert into schema_migrations(name) values($1)', [name]);
        }
      }
    });
  } finally { await db.destroy(); }
}
if (process.argv[1]?.endsWith('/migrate.ts') || process.argv[1]?.endsWith('/migrate.js')) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('Defina DATABASE_ADMIN_URL para migrações.');
  await migrate(url); process.stdout.write('Migrações aplicadas.\n');
}
