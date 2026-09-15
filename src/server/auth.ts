import * as oidc from 'openid-client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../shared/domain.js';
import type { Config } from './config.js';
import { decrypt, encrypt, hash, token } from './crypto.js';
import { one, query, type DB, type Tx } from './db.js';
import { audit, operation } from './records.js';

async function logAccess(tx: Tx, userId: string, sessionId: string, action: 'login' | 'logout', key: string): Promise<void> {
  for (const member of await query<{ organization_id: string; role: 'admin' | 'user'; schema_version: number }>(tx, 'select m.organization_id,m.role,o.schema_version from memberships m join organizations o on o.id=m.organization_id where user_id=$1 and active=true order by m.organization_id', [userId])) {
    await query(tx, "select set_config('app.organization_id',$1,true)", [member.organization_id]);
    const actor = { userId, sessionId, organizationId: member.organization_id, role: member.role, schemaVersion: member.schema_version };
    await operation(tx, actor, randomUUID(), action, 'auth', {}, async op => { await audit(tx, actor, op, key, 'user', userId, action, null, true); return { ok: true }; });
  }
}

export interface Identity { userId: string; sessionId: string; csrf: string }
function identityFetch(cfg: Config): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (cfg.OIDC_INTERNAL_URL && url.origin === new URL(cfg.OIDC_ISSUER).origin) {
      const internal = new URL(cfg.OIDC_INTERNAL_URL); url.protocol = internal.protocol; url.host = internal.host;
    }
    return fetch(url, init);
  };
}
export function cookie(request: FastifyRequest, name: string): string | undefined { return request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1); }
function setCookie(reply: FastifyReply, name: string, value: string, cfg: Config, maxAge: number): void { reply.header('set-cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.APP_URL.startsWith('https:') ? '; Secure' : ''}`); }
export async function identity(db: DB, request: FastifyRequest): Promise<Identity> {
  const raw = cookie(request, 'rh_session'); if (!raw) throw new DomainError(401, 'UNAUTHENTICATED', 'Entre para continuar.');
  const session = (await query<{ id: string; user_id: string; csrf: string }>(db, 'select id,user_id,csrf from sessions where id=$1 and expires_at>now()', [hash(raw)]))[0];
  if (!session) throw new DomainError(401, 'UNAUTHENTICATED', 'Sessão expirada. Entre novamente.');
  return { userId: session.user_id, sessionId: session.id, csrf: session.csrf };
}
export function checkCsrf(request: FastifyRequest, auth: Identity, cfg: Config): void {
  const supplied = request.headers['x-csrf-token'];
  if (request.headers.origin !== new URL(cfg.APP_URL).origin || typeof supplied !== 'string' || supplied.length !== auth.csrf.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(auth.csrf))) throw new DomainError(403, 'CSRF', 'Solicitação não autorizada. Atualize a página.');
}
export async function issueSession(db: DB, userId: string): Promise<{ raw: string; id: string; csrf: string }> {
  const raw = token(); const id = hash(raw); const csrf = token();
  await query(db, "insert into sessions(id,user_id,csrf,expires_at) values($1,$2,$3,now()+interval '8 hours')", [id, userId, csrf]); return { raw, id, csrf };
}
export function registerAuth(app: FastifyInstance, db: DB, cfg: Config): void {
  let discovery: Promise<oidc.Configuration> | undefined;
  const getOidc = () => discovery ??= oidc.discovery(new URL(cfg.OIDC_ISSUER), cfg.OIDC_CLIENT_ID, cfg.OIDC_CLIENT_SECRET, undefined, { [oidc.customFetch]: (url, options) => identityFetch(cfg)(url, { ...options, body: options.body instanceof Uint8Array ? new Uint8Array(options.body).buffer : options.body }), ...(cfg.NODE_ENV === 'production' ? {} : { execute: [oidc.allowInsecureRequests] }) }).catch(() => { discovery = undefined; throw new DomainError(503, 'IDENTITY_UNAVAILABLE', 'O serviço de login está iniciando ou temporariamente indisponível. Aguarde alguns segundos e tente entrar novamente.'); });
  app.get('/auth/login', async (req, reply) => {
    const queryParams = req.query as { invite?: string };
    const invite = queryParams.invite;
    if (invite && !/^[A-Za-z0-9_-]{43}$/.test(invite)) throw new DomainError(400, 'INVITATION', 'Convite inválido.');
    if (invite) await one(db, 'select id from invitations where token_hash=$1 and accepted_at is null and expires_at>now()', [hash(invite)]);
    const config = await getOidc(); const verifier = oidc.randomPKCECodeVerifier(); const state = oidc.randomState(); const nonce = oidc.randomNonce(); const browserToken = token();
    await query(db, "insert into login_states(id,encrypted,expires_at) values($1,$2,now()+interval '10 minutes')", [hash(browserToken), encrypt({ verifier, state, nonce, invite }, cfg.AUDIT_KEY)]);
    setCookie(reply, 'rh_login', browserToken, cfg, 600);
    return reply.redirect(oidc.buildAuthorizationUrl(config, { redirect_uri: `${cfg.APP_URL}/auth/callback`, scope: 'openid email profile', code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce }).href);
  });
  app.get('/auth/callback', async (req, reply) => {
    const browserToken = cookie(req, 'rh_login'); if (!browserToken) throw new DomainError(401, 'LOGIN', 'Login expirado.');
    const record = (await query<{ encrypted: string }>(db, 'delete from login_states where id=$1 and expires_at>now() returning encrypted', [hash(browserToken)]))[0];
    if (!record) throw new DomainError(401, 'LOGIN', 'Login expirado ou já utilizado.');
    const saved = decrypt<{ verifier: string; state: string; nonce: string; invite?: string }>(record.encrypted, cfg.AUDIT_KEY);
    const config = await getOidc();
    const tokens = await oidc.authorizationCodeGrant(config, new URL(req.url, cfg.APP_URL), { pkceCodeVerifier: saved.verifier, expectedState: saved.state, expectedNonce: saved.nonce, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims || typeof claims.email !== 'string' || claims.email_verified !== true) throw new DomainError(403, 'EMAIL_UNVERIFIED', 'Confirme seu endereço de e-mail.');
    const email = claims.email.toLowerCase();
    const userId = await db.transaction().execute(async tx => {
      // Only the bootstrap command may create pending identities. A verified OIDC email claims them once.
      await query(tx, 'update users set subject=$1 where subject=$2', [claims.sub, `pending:${email}`]);
      let user = (await query<{ id: string }>(tx, 'select id from users where subject=$1', [claims.sub]))[0];
      if (saved.invite) {
        const invitation = (await query<{ id: string; organization_id: string; role: string; created_by: string }>(tx, 'select id,organization_id,role,created_by from invitations where token_hash=$1 and lower(email)=$2 and accepted_at is null and expires_at>now() for update', [hash(saved.invite), email]))[0];
        if (!invitation) throw new DomainError(403, 'INVITATION', 'Convite inválido, expirado ou destinado a outra pessoa.');
        await query(tx, 'select id from organizations where id=$1 for update', [invitation.organization_id]);
        if (!(await query(tx, "select 1 from memberships where organization_id=$1 and user_id=$2 and active=true and role='admin'", [invitation.organization_id, invitation.created_by])).length) throw new DomainError(403, 'INVITATION', 'O administrador que emitiu este convite não tem mais acesso.');
        if (!user) user = await one<{ id: string }>(tx, 'insert into users(subject,name,email) values($1,$2,$3) returning id', [claims.sub, typeof claims.name === 'string' ? claims.name : email, email]);
        await query(tx, 'insert into memberships(organization_id,user_id,role) values($1,$2,$3) on conflict(organization_id,user_id) do update set active=true,role=case when memberships.active then memberships.role else excluded.role end', [invitation.organization_id, user.id, invitation.role]);
        await query(tx, 'update invitations set accepted_at=now() where id=$1', [invitation.id]);
        await query(tx, "select set_config('app.organization_id',$1,true)", [invitation.organization_id]);
        const op = randomUUID();
        await query(tx, "insert into operations(organization_id,id,actor_id,session_id,action,source,correlation_id,request_hash) values($1,$2,$3,'login','accept_invite','auth',$2,$4)", [invitation.organization_id, op, user.id, op]);
        await query(tx, "insert into audit_events(organization_id,operation_id,entity,entity_id,field,payload) values($1,$2,'membership',$3,'active',$4)", [invitation.organization_id, op, user.id, encrypt({ before: false, after: true }, cfg.AUDIT_KEY)]);
        await query(tx, 'insert into outbox(organization_id,operation_id) values($1,$2)', [invitation.organization_id, op]);
      }
      if (!user || !(await query(tx, 'select 1 from memberships where user_id=$1 and active=true', [user.id])).length) throw new DomainError(403, 'INVITATION_REQUIRED', 'Solicite um convite ao administrador.');
      return user.id;
    });
    const session = await issueSession(db, userId);
    await db.transaction().execute(tx => logAccess(tx, userId, session.id, 'login', cfg.AUDIT_KEY));
    setCookie(reply, 'rh_session', session.raw, cfg, 28800); return reply.redirect('/');
  });
  app.post('/auth/logout', async (req, reply) => { const auth = await identity(db, req); checkCsrf(req, auth, cfg); await db.transaction().execute(async tx => { await logAccess(tx, auth.userId, auth.sessionId, 'logout', cfg.AUDIT_KEY); await query(tx, 'delete from sessions where id=$1', [auth.sessionId]); }); setCookie(reply, 'rh_session', '', cfg, 0); return { ok: true }; });
  app.get('/api/session', async req => {
    const auth = await identity(db, req);
    const user = await one(db, 'select id,name from users where id=$1', [auth.userId]);
    const organizations = await query(db, 'select o.id,o.name,o.timezone,o.schema_version,m.role from organizations o join memberships m on m.organization_id=o.id where m.user_id=$1 and m.active=true order by o.name', [auth.userId]);
    return { user, organizations, csrf: auth.csrf };
  });
}

export async function sendInvitation(cfg: Config, email: string, inviteToken: string): Promise<void> {
  const fetch = identityFetch(cfg);
  if (!cfg.KEYCLOAK_ADMIN_CLIENT_SECRET) throw new DomainError(503, 'INVITE_UNAVAILABLE', 'Configure o provisionador Keycloak e SMTP para enviar convites.');
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.KEYCLOAK_ADMIN_CLIENT_ID, client_secret: cfg.KEYCLOAK_ADMIN_CLIENT_SECRET });
  const tokenResponse = await fetch(`${cfg.OIDC_ISSUER}/protocol/openid-connect/token`, { method: 'POST', body, signal: AbortSignal.timeout(10000) });
  if (!tokenResponse.ok) throw new DomainError(503, 'INVITE_UNAVAILABLE', 'Não foi possível conectar ao serviço de identidade.');
  const result = await tokenResponse.json() as { access_token: string };
  const realmUrl = new URL(cfg.OIDC_ISSUER); const realm = realmUrl.pathname.split('/').at(-1)!;
  const base = `${realmUrl.origin}/admin/realms/${encodeURIComponent(realm)}`;
  const headers = { authorization: `Bearer ${result.access_token}`, 'content-type': 'application/json' };
  const existing = await fetch(`${base}/users?email=${encodeURIComponent(email)}&exact=true`, { headers, signal: AbortSignal.timeout(10000) });
  if (!existing.ok) throw new DomainError(503, 'INVITE_UNAVAILABLE', 'Falha ao consultar identidade.');
  const users = await existing.json() as { id: string }[];
  let id = users[0]?.id;
  if (!id) {
    const created = await fetch(`${base}/users`, { method: 'POST', headers, body: JSON.stringify({ username: email, email, enabled: true, emailVerified: false }), signal: AbortSignal.timeout(10000) });
    if (!created.ok) throw new DomainError(503, 'INVITE_UNAVAILABLE', 'Falha ao preparar convite.');
    id = created.headers.get('location')?.split('/').at(-1);
  }
  if (!id) throw new DomainError(503, 'INVITE_UNAVAILABLE', 'Identidade indisponível.');
  const params = new URLSearchParams({ client_id: cfg.OIDC_CLIENT_ID, redirect_uri: `${cfg.APP_URL}/auth/login?invite=${inviteToken}`, lifespan: '86400' });
  const response = await fetch(`${base}/users/${id}/execute-actions-email?${params}`, { method: 'PUT', headers, body: JSON.stringify(users.length ? ['VERIFY_EMAIL'] : ['VERIFY_EMAIL', 'UPDATE_PASSWORD']), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new DomainError(503, 'INVITE_UNAVAILABLE', 'Falha no envio. Verifique o SMTP do Keycloak.');
}
