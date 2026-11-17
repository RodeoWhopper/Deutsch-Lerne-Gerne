// Account provisioning, used only by the setup CLI and tests. No web route reaches this.
import { randomBytes, randomInt } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { getDb, tx } from './db.ts';
import { argonParams, recoveryHash } from './auth.ts';
import { b32encode, newSecret, otpauthUri } from './totp.ts';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.!#%+=@';

export function generatePassword(len = 28): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Raise timeCost until a hash takes >= targetMs on this machine (spec: ~250-500 ms). */
export async function calibrate(targetMs = 300): Promise<{ t: number; m: number; ms: number }> {
  const m = Number(process.env.ARGON_MEMORY_KIB) || 65536;
  for (let t = 3; t <= 24; t++) {
    const s = performance.now();
    await hash('calibration', argonParams(t, m));
    const ms = performance.now() - s;
    if (ms >= targetMs || t === 24) return { t, m, ms: Math.round(ms) };
  }
  return { t: 3, m, ms: 0 };
}

export interface Provisioned {
  username: string;
  password: string;
  totpSecret: string;
  otpauth: string;
  recoveryCodes: string[];
  argon: { t: number; m: number; ms: number };
}

export async function provision(username: string, reset: boolean): Promise<Provisioned> {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM users WHERE id=1').get();
  if (exists && !reset) throw new Error('Kullanıcı zaten var. Kimlik bilgilerini yenilemek için --reset kullan.');
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('Kullanıcı adı 3-32 karakter olmalı (harf, rakam, _ . -).');
  const password = generatePassword();
  const argon = await calibrate();
  const pw_hash = await hash(password, argonParams(argon.t, argon.m));
  const secret = newSecret();
  const codes = Array.from({ length: 10 }, () => b32encode(randomBytes(10)));
  tx(db, () => {
    db.prepare('DELETE FROM recovery_codes').run();
    db.prepare('DELETE FROM totp').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('INSERT INTO users(id,username,pw_hash,created_at) VALUES(1,?,?,?)').run(username, pw_hash, Date.now());
    db.prepare('INSERT INTO totp(user_id,secret,last_step) VALUES(1,?,0)').run(secret);
    const ins = db.prepare('INSERT INTO recovery_codes(user_id,code_hash) VALUES(1,?)');
    for (const c of codes) ins.run(recoveryHash(c));
    db.prepare('DELETE FROM sessions').run(); // credentials changed: every session drops
    db.prepare('DELETE FROM challenges').run();
    db.prepare('DELETE FROM auth_fail').run();
  });
  return {
    username, password, totpSecret: secret, otpauth: otpauthUri(secret, username), argon,
    recoveryCodes: codes.map((c) => c.match(/.{4}/g)!.join('-')),
  };
}

/**
 * Optional bootstrap from env (SEED_USERNAME / SEED_PASSWORD). Runs only while NO user exists, never overwrites.
 * The account has no TOTP yet: it is enrolled at first login (password is verified first).
 * Returns a status string for the (secret-free) startup log.
 */
export async function seedFromEnv(env = process.env): Promise<'none' | 'exists' | 'weak' | 'created'> {
  const username = env.SEED_USERNAME?.trim();
  const password = env.SEED_PASSWORD;
  if (!username || !password) return 'none';
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE id=1').get()) return 'exists';
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 12) return 'weak';
  const argon = await calibrate();
  const pw_hash = await hash(password, argonParams(argon.t, argon.m));
  tx(db, () => {
    if (db.prepare('SELECT 1 FROM users WHERE id=1').get()) return;
    db.prepare('INSERT INTO users(id,username,pw_hash,created_at) VALUES(1,?,?,?)').run(username, pw_hash, Date.now());
  });
  return 'created';
}
