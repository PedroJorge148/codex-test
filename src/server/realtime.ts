import pg from 'pg';
import type { ServerResponse } from 'node:http';
import { query, type DB } from './db.js';
interface Subscriber { organizationId: string; userId: string; sessionId: string; response: ServerResponse }
export class Realtime {
  private readonly subscribers = new Set<Subscriber>();
  private client?: pg.Client;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  constructor(private readonly db: DB, private readonly url: string) {
    this.heartbeat = setInterval(() => { void this.revalidate(); }, 10000);
    this.heartbeat.unref();
  }
  async start(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.url }); this.client = client;
    const retry = () => { if (!this.stopped && !this.retry) this.retry = setTimeout(() => { this.retry = undefined; void this.start(); }, 2000); };
    client.on('error', () => { void client.end().catch(() => undefined); retry(); });
    client.on('end', retry);
    client.on('notification', message => {
      if (!message.payload) return;
      try { const event = JSON.parse(message.payload) as { organizationId: string; id: string; operationId: string }; void this.publish(event); } catch { /* Only metadata is expected on this channel. */ }
    });
    try { await client.connect(); await client.query('LISTEN rh_changes'); for (const sub of this.subscribers) sub.response.write('event: reconcile\ndata: {}\n\n'); }
    catch { void client.end().catch(() => undefined); retry(); }
  }
  add(sub: Subscriber): void { this.subscribers.add(sub); sub.response.on('close', () => this.subscribers.delete(sub)); }
  async allowed(sub: Subscriber): Promise<boolean> { return (await query(this.db, 'select 1 from memberships m join sessions s on s.user_id=m.user_id where m.organization_id=$1 and m.user_id=$2 and m.active=true and s.id=$3 and s.expires_at>now()', [sub.organizationId, sub.userId, sub.sessionId])).length > 0; }
  private async publish(event: { organizationId: string; id: string; operationId: string }): Promise<void> {
    for (const sub of this.subscribers) if (sub.organizationId === event.organizationId) {
      try { if (await this.allowed(sub)) { if (!sub.response.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`)) sub.response.end(); } else sub.response.end(); }
      catch { sub.response.end(); }
    }
  }
  private async revalidate(): Promise<void> {
    for (const sub of this.subscribers) {
      try { if (await this.allowed(sub)) sub.response.write(': heartbeat\n\n'); else sub.response.end(); }
      catch { sub.response.end(); }
    }
  }
  revoke(organizationId: string, userId: string): void { for (const sub of this.subscribers) if (sub.organizationId === organizationId && sub.userId === userId) sub.response.end(); }
  async close(): Promise<void> { this.stopped = true; clearInterval(this.heartbeat); clearTimeout(this.retry); for (const sub of this.subscribers) sub.response.end(); await this.client?.end().catch(() => undefined); }
}
