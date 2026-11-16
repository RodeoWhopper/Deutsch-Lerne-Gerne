import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { config } from './config.ts';
import { getDb } from './db.ts';

getDb();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (i) => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: i.port }));
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
