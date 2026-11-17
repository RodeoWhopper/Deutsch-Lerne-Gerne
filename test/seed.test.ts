import './env.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setDb, getDb } from '../src/server/db.ts';
import { Client } from './helpers.ts';
import { hotp, stepOf } from '../src/server/totp.ts';

test('SEED_*: kullanıcı yoksa oluşturur; zayıf parolayı reddeder; mevcutu ezmez; TOTP ilk girişte kaydedilir', async () => {
  setDb(openDb(':memory:'));
  const { seedFromEnv } = await import('../src/server/provision.ts');
  const { app } = await import('../src/server/app.ts');
  const { clock } = await import('../src/server/auth.ts');
  assert.equal(await seedFromEnv({}), 'none');
  assert.equal(await seedFromEnv({ SEED_USERNAME: 'huseyin', SEED_PASSWORD: 'short' }), 'weak');
  assert.equal(await seedFromEnv({ SEED_USERNAME: 'huseyin', SEED_PASSWORD: 'correct horse battery' }), 'created');
  assert.equal(await seedFromEnv({ SEED_USERNAME: 'other', SEED_PASSWORD: 'another long password' }), 'exists');
  const row = getDb().prepare('SELECT username, pw_hash FROM users').get() as { username: string; pw_hash: string };
  assert.equal(row.username, 'huseyin'); assert.match(row.pw_hash, /^\$argon2id\$/);
  assert.ok(!row.pw_hash.includes('correct horse'));

  const c = new Client(app, '192.0.2.50');
  // wrong password
  assert.equal((await c.req('POST', '/api/auth/login', { username: 'huseyin', password: 'nope-nope-nope' })).status, 401);
  // totp endpoint useless before enrollment
  const r1 = await c.req('POST', '/api/auth/login', { username: 'huseyin', password: 'correct horse battery' });
  const j1 = (await r1.json()) as { challenge: string; enroll: boolean };
  assert.equal(j1.enroll, true);
  assert.equal((await c.req('POST', '/api/auth/totp', { challenge: j1.challenge, code: '123456' })).status, 401);
  // enroll-start needs a valid challenge
  assert.equal((await c.req('POST', '/api/auth/enroll-start', { challenge: 'x'.repeat(20) })).status, 401);
  const r2 = await c.req('POST', '/api/auth/login', { username: 'huseyin', password: 'correct horse battery' });
  const { challenge } = (await r2.json()) as { challenge: string };
  const st = await c.req('POST', '/api/auth/enroll-start', { challenge });
  assert.equal(st.status, 200);
  const { secret, otpauth } = (await st.json()) as { secret: string; otpauth: string };
  assert.match(otpauth, /^otpauth:\/\/totp\//);
  const raw = secret.replace(/ /g, '');
  // wrong code rejected, no session
  assert.equal((await c.req('POST', '/api/auth/enroll-finish', { challenge, code: '000000' })).status, 401);
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);
  clock.skew += 90_000;
  const fin = await c.req('POST', '/api/auth/enroll-finish', { challenge, code: hotp(raw, stepOf(clock.now())) });
  assert.equal(fin.status, 200);
  const f = (await fin.json()) as { recovery_codes: string[]; csrf: string };
  assert.equal(f.recovery_codes.length, 10);
  c.csrf = f.csrf;
  assert.equal((await c.req('GET', '/api/auth/me')).status, 200);
  // enrollment is one-shot: now closed
  const r3 = await c.req('POST', '/api/auth/login', { username: 'huseyin', password: 'correct horse battery' });
  const j3 = (await r3.json()) as { challenge: string; enroll: boolean };
  assert.equal(j3.enroll, false);
  assert.equal((await c.req('POST', '/api/auth/enroll-start', { challenge: j3.challenge })).status, 401);
  // same TOTP step cannot be reused for a normal login (replay)
  assert.equal((await c.req('POST', '/api/auth/totp', { challenge: j3.challenge, code: hotp(raw, stepOf(clock.now())) })).status, 401);
  // recovery codes stored hashed only
  assert.ok(!JSON.stringify(getDb().prepare('SELECT * FROM recovery_codes').all()).includes(f.recovery_codes[0].replace(/-/g, '')));
});
