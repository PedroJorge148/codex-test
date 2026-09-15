import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
await mkdir('.local', { recursive: true, mode: 0o700 });
try { await readFile('.local/dev.env'); process.stdout.write('Configuração existente preservada em .local/dev.env.\n'); }
catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  const keys = ['POSTGRES_PASSWORD', 'DATABASE_APP_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'KEYCLOAK_BOOTSTRAP_PASSWORD', 'OIDC_CLIENT_SECRET', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'INITIAL_ADMIN_PASSWORD', 'AUDIT_KEY'];
  await writeFile('.local/dev.env', keys.map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write('Configuração criada em .local/dev.env. Credenciais não foram exibidas.\n');
}
