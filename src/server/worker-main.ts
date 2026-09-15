import { readConfig } from './config.js';
import { connect, verifyRuntimeRole } from './db.js';
import { cleanup, workerTick } from './worker.js';
const cfg = readConfig(); const db = connect(cfg.DATABASE_URL); await verifyRuntimeRole(db);
let stopping = false; let ticks = 0;
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
while (!stopping) {
  try { await workerTick(db, cfg); if (ticks++ % 60 === 0) await cleanup(db, cfg); }
  catch { process.stderr.write(JSON.stringify({ level: 'error', code: 'WORKER_TICK_FAILED', time: new Date().toISOString() }) + '\n'); }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await db.destroy();
