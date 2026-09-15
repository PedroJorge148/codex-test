import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export function token(): string { return randomBytes(32).toString('base64url'); }
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function encrypt(value: unknown, key: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function decrypt<T>(value: string, key: string): T {
  const [iv, tag, data] = value.split('.');
  if (!iv || !tag || !data) throw new Error('Payload criptografado inválido.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'base64')); cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8')) as T;
}
