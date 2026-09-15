import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000), HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1), DATABASE_ADMIN_URL: z.string().optional(),
  APP_URL: z.url().default('http://localhost:5173'),
  AUDIT_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  OIDC_ISSUER: z.url().default('http://localhost:8080/realms/rh'), OIDC_CLIENT_ID: z.string().default('rh-web'),
  OIDC_INTERNAL_URL: z.url().optional(),
  OIDC_CLIENT_SECRET: z.string().min(1), KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('rh-provisioner'), KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  RETENTION_APPROVED: z.enum(['true', 'false']).default('false'),
  RETENTION_DAYS: z.coerce.number().int().positive().optional(), AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  AUTH_TEST_MODE: z.enum(['true', 'false']).default('false')
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) throw new Error(`Configuração inválida: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const cfg = result.data;
  if (cfg.AUTH_TEST_MODE === 'true' && cfg.NODE_ENV !== 'test') throw new Error('Autenticação de teste exige NODE_ENV=test.');
  if (cfg.NODE_ENV === 'production' && (!cfg.APP_URL.startsWith('https:') || !cfg.OIDC_ISSUER.startsWith('https:') || cfg.RETENTION_APPROVED !== 'true' || !cfg.RETENTION_DAYS || !cfg.AUDIT_RETENTION_DAYS)) throw new Error('Produção exige HTTPS e política de retenção aprovada.');
  return cfg;
}
