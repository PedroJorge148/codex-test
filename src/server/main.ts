import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { connect, verifyRuntimeRole } from './db.js';
const cfg = readConfig(); const db = connect(cfg.DATABASE_URL); await verifyRuntimeRole(db);
const app = await buildApp(db, cfg);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => db.destroy()); });
await app.listen({ host: cfg.HOST, port: cfg.PORT });
