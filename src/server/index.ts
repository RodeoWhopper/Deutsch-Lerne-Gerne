import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { config } from './config.ts';
import { getDb } from './db.ts';
import { seedFromEnv } from './provision.ts';

getDb();
const seeded = await seedFromEnv();
if (seeded !== 'none') console.log(JSON.stringify({ level: seeded === 'weak' ? 'error' : 'info', msg: 'seed', result: seeded, hint: seeded === 'weak' ? 'SEED_USERNAME 3-32 karakter, SEED_PASSWORD en az 12 karakter olmalı' : seeded === 'created' ? 'ilk girişte TOTP kaydı yapılır; SEED_PASSWORD değişkenini sil' : undefined }));
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (i) => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: i.port }));
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
