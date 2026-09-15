import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { connect, one, query } from '../src/server/db.js';
import { eraseCandidate } from '../src/server/worker.js';

const env = parseEnv(await readFile('.local/dev.env', 'utf8'));
const key = Buffer.from(env.AUDIT_KEY!, 'hex'); if (key.length !== 32) throw new Error('Chave de backup inválida.');
const mode = process.argv[2];
const directory = resolve(process.argv[3] ?? `.local/backups/${new Date().toISOString().replaceAll(':', '-')}`);
function command(args: string[]) {
  const child = spawn('docker', ['compose', '--env-file', '.local/dev.env', 'exec', '-T', 'postgres', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  // Database diagnostics can contain SQL; do not forward them into application logs.
  child.stderr.resume();
  const done = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Comando de recuperação falhou.'))); });
  return { child, done };
}
if (mode === 'backup') {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const database of ['rh', 'keycloak']) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const file = createWriteStream(resolve(directory, `${database}.dump.enc`), { mode: 0o600, flags: 'wx' });
    file.write(iv); const { child, done } = command(['pg_dump', '-U', 'postgres', '-Fc', database]); child.stdin.end();
    await Promise.all([pipeline(child.stdout, cipher, file, { end: false }), done]);
    await new Promise<void>((resolve, reject) => { file.on('error', reject); file.end(cipher.getAuthTag(), resolve); });
  }
  process.stdout.write(`Backups criptografados de aplicação e identidade: ${directory}\n`);
} else if (mode === 'rehearse') {
  // Always restore into a fresh isolated database. Never overwrite the running MVP.
  const restored = `rh_recovery_${randomUUID().replaceAll('-', '')}`;
  const { child: create, done: created } = command(['createdb', '-U', 'postgres', restored]); create.stdin.end(); await created;
  const path = resolve(directory, 'rh.dump.enc'); const size = (await stat(path)).size;
  const handle = await import('node:fs/promises').then(fs => fs.open(path, 'r'));
  const iv = Buffer.alloc(12); const tag = Buffer.alloc(16);
  try { await handle.read(iv, 0, 12, 0); await handle.read(tag, 0, 16, size - 16); } finally { await handle.close(); }
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
  const { child, done } = command(['pg_restore', '-U', 'postgres', '--exit-on-error', '--no-owner', '--no-acl', '-d', restored]); child.stdout.resume();
  await Promise.all([pipeline(createReadStream(path, { start: 12, end: size - 17 }), decipher, child.stdin), done]);
  const liveUrl = `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:55433/rh`;
  const live = connect(liveUrl); const target = connect(liveUrl.replace(/\/rh$/, `/${restored}`));
  try {
    // The current ledger, not the one embedded in the old dump, must be replayed.
    const ledger = await query<{ organization_id: string; candidate_id: string }>(live, 'select organization_id,candidate_id from erasure_ledger');
    for (const item of ledger) await target.transaction().execute(async tx => {
      const exists = await query(tx, 'select 1 from candidates where organization_id=$1 and id=$2', [item.organization_id, item.candidate_id]); if (!exists.length) return;
      await query(tx, "select set_config('app.organization_id',$1,true)", [item.organization_id]);
      const actor = await one<{ user_id: string }>(tx, "select user_id from memberships where organization_id=$1 and role='admin' order by user_id limit 1", [item.organization_id]);
      await eraseCandidate(tx, { organizationId: item.organization_id, userId: actor.user_id, sessionId: 'recovery', role: 'admin', schemaVersion: 1 }, item.candidate_id, env.AUDIT_KEY!);
      const candidate = await one<{ email: string | null; phone: string | null; name: string }>(tx, 'select email,phone,name from candidates where id=$1', [item.candidate_id]);
      if (candidate.email || candidate.phone || candidate.name !== '[Dados eliminados]') throw new Error('Falha ao reaplicar eliminação.');
    });
    await query(target, 'delete from sessions'); await query(target, 'delete from login_states');
    process.stdout.write(`Recuperação validada no banco isolado ${restored}. ${ledger.length} entradas de eliminação verificadas. O MVP original foi preservado.\n`);
  } finally { await live.destroy(); await target.destroy(); }
} else throw new Error('Use recovery.ts backup [diretório] ou recovery.ts rehearse <diretório>.');
