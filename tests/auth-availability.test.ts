import { afterEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerAuth } from '../src/server/auth.js';
import { connect } from '../src/server/db.js';
import { DomainError } from '../src/shared/domain.js';

afterEach(() => vi.unstubAllGlobals());

it('retorna indisponibilidade segura e tenta novamente quando o provedor está iniciando', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
  vi.stubGlobal('fetch', fetch);
  const db = connect('postgresql://unused:unused@localhost:1/unused_test');
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.status).send({ code: error.code, message: error.message });
    return reply.code(500).send({ code: 'UNEXPECTED' });
  });
  registerAuth(app, db, {
    NODE_ENV: 'test', PORT: 3000, HOST: 'localhost', DATABASE_URL: 'unused',
    APP_URL: 'http://localhost:3000', AUDIT_KEY: 'a'.repeat(64),
    OIDC_ISSUER: 'http://localhost:8080/realms/rh', OIDC_INTERNAL_URL: 'http://keycloak:8080',
    OIDC_CLIENT_ID: 'rh-web', OIDC_CLIENT_SECRET: 'test-secret',
    KEYCLOAK_ADMIN_CLIENT_ID: 'rh-provisioner', RETENTION_APPROVED: 'false', AUTH_TEST_MODE: 'false'
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.inject({ method: 'GET', url: '/auth/login' });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('IDENTITY_UNAVAILABLE');
      expect(response.body).not.toContain('test-secret');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { await app.close(); await db.destroy(); }
});
