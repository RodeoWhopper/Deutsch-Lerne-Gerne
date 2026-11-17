import './env-notp.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setDb } from '../src/server/db.ts';
import { Client } from './helpers.ts';

test('REQUIRE_TOTP=0: parola yeterli, TOTP/enroll uçları kapalı, hata sayacı hâlâ çalışır', async () => {
  setDb(openDb(':memory:'));
  const { seedFromEnv } = await import('../src/server/provision.ts');
  const { app } = await import('../src/server/app.ts');
  assert.equal(await seedFromEnv({ SEED_USERNAME: 'huseyin', SEED_PASSWORD: 'abcdefghij1' }), 'created'); // 11 karakter
  const c = new Client(app, '192.0.2.60');
  const ok = await c.req('POST', '/api/auth/login', { username: 'huseyin', password: 'abcdefghij1' });
  assert.equal(ok.status, 200);
  const j = (await ok.json()) as { ok: boolean; csrf: string };
  assert.equal(j.ok, true);
  assert.match(c.lastSetCookie, /^__Host-sid=.*HttpOnly.*Secure.*SameSite=Strict/i);
  c.csrf = j.csrf;
  assert.equal((await c.req('GET', '/api/auth/me')).status, 200);
  const other = new Client(app, '192.0.2.61');
  assert.equal((await other.req('POST', '/api/auth/totp', { challenge: 'x'.repeat(20), code: '123456' })).status, 401);
  assert.equal((await other.req('POST', '/api/auth/enroll-start', { challenge: 'x'.repeat(20) })).status, 401);
  // brute force protection stays on
  const bf = new Client(app, '192.0.2.62');
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) codes.push((await bf.req('POST', '/api/auth/login', { username: 'huseyin', password: 'wrong' + i })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
});
