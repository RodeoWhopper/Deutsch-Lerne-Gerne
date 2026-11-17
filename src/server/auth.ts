import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getDb, tx } from './db.ts';
import { config } from './config.ts';
import { clientIp, ipKey, sha256, shortUa, truncIp } from './security.ts';
import { matchStep } from './totp.ts';

/** Injectable clock for second-factor checks (tests advance it; production skew is always 0). */
export const clock = { skew: 0, now: () => Date.now() + clock.skew };
export const COOKIE = 'sid'; // becomes __Host-sid via prefix option
const DAY = 86_400_000;
export const ABS_LIFETIME = 30 * DAY;
export const IDLE_LIFETIME = 14 * DAY;
export const CHALLENGE_TTL = 5 * 60_000;
export const argonParams = (t = 3, m = 65536) => ({ algorithm: 2 as Algorithm /* Argon2id */, memoryCost: m, timeCost: t, parallelism: 1 });
const ARGON_DEFAULT = argonParams();

let dummyHash: string | null = null;
async function getDummy() {
  return (dummyHash ??= await hash('dummy-password-for-timing', ARGON_DEFAULT));
}

export const recoveryHash = (code: string) => sha256('rc:' + code.replace(/[\s-]/g, '').toUpperCase());

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------- brute force (exponential delay, never a permanent lock) ----------
function delaySeconds(count: number, threshold: number) {
  if (count < threshold) return 0;
  return Math.min(900, 2 ** (count - threshold + 1));
}
const scopes = (c: Context) => [
  { scope: 'ip:' + ipKey(clientIp(c)), threshold: config.ipFailThreshold },
  { scope: 'global', threshold: config.globalFailThreshold },
];

/** Seconds the caller must wait, 0 if allowed. */
export function throttleWait(c: Context, now = Date.now()): number {
  const db = getDb();
  let wait = 0;
  for (const { scope, threshold } of scopes(c)) {
    const r = db.prepare('SELECT count,last_fail FROM auth_fail WHERE scope=?').get(scope) as { count: number; last_fail: number } | undefined;
    if (!r) continue;
    if (now - r.last_fail > DAY) continue; // decay
    const until = r.last_fail + delaySeconds(r.count, threshold) * 1000;
    wait = Math.max(wait, Math.ceil((until - now) / 1000));
  }
  return Math.max(0, wait);
}
export function recordFailure(c: Context, now = Date.now()) {
  const db = getDb();
  for (const { scope } of scopes(c)) {
    const r = db.prepare('SELECT count,last_fail FROM auth_fail WHERE scope=?').get(scope) as { count: number; last_fail: number } | undefined;
    const count = !r || now - r.last_fail > DAY ? 1 : r.count + 1;
    db.prepare('INSERT INTO auth_fail(scope,count,last_fail) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET count=excluded.count,last_fail=excluded.last_fail').run(scope, count, now);
  }
}
export function recordSuccess(c: Context) {
  const db = getDb();
  for (const { scope } of scopes(c)) db.prepare('DELETE FROM auth_fail WHERE scope=?').run(scope);
}

export function audit(c: Context, event: string, ok: boolean) {
  getDb()
    .prepare('INSERT INTO login_audit(at,ip_trunc,ua,event,ok) VALUES(?,?,?,?,?)')
    .run(Date.now(), truncIp(clientIp(c)), shortUa(c.req.header('user-agent')), event, ok ? 1 : 0);
}

// ---------- credentials ----------
export async function checkPassword(username: string, password: string): Promise<boolean> {
  const u = getDb().prepare('SELECT username,pw_hash FROM users WHERE id=1').get() as { username: string; pw_hash: string } | undefined;
  const h = u?.pw_hash ?? (await getDummy());
  let pwOk = false;
  try { pwOk = await verify(h, password); } catch { pwOk = false; }
  const userOk = !!u && safeEq(sha256('u:' + u.username), sha256('u:' + username));
  return !!u && pwOk && userOk;
}

export async function checkPasswordOnly(password: string): Promise<boolean> {
  const u = getDb().prepare('SELECT pw_hash FROM users WHERE id=1').get() as { pw_hash: string } | undefined;
  const h = u?.pw_hash ?? (await getDummy());
  try { return !!u && (await verify(h, password)); } catch { return false; }
}

/** Second factor: TOTP (replay-protected) or one-time recovery code. */
export function checkSecondFactor(code: string, now = clock.now()): 'totp' | 'recovery' | null {
  const db = getDb();
  const c = code.trim();
  if (/^\d{6}$/.test(c)) {
    return tx(db, () => {
      const t = db.prepare('SELECT secret,last_step FROM totp WHERE user_id=1').get() as { secret: string; last_step: number } | undefined;
      if (!t) return null;
      const step = matchStep(t.secret, c, now);
      if (step === null || step <= t.last_step) return null; // replay or wrong
      db.prepare('UPDATE totp SET last_step=? WHERE user_id=1').run(step);
      return 'totp' as const;
    });
  }
  const rc = c.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-Z2-7]{16}$/.test(rc)) {
    return tx(db, () => {
      const r = db.prepare('SELECT id FROM recovery_codes WHERE code_hash=? AND used_at IS NULL').get(recoveryHash(rc)) as { id: number } | undefined;
      if (!r) return null;
      db.prepare('UPDATE recovery_codes SET used_at=? WHERE id=?').run(now, r.id);
      return 'recovery' as const;
    });
  }
  return null;
}

// ---------- challenges (between password and TOTP) ----------
export function createChallenge(now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  const db = getDb();
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now);
  db.prepare('INSERT INTO challenges(token_hash,expires_at) VALUES(?,?)').run(sha256(token), now + CHALLENGE_TTL);
  return token;
}
export function takeChallengeAttempt(token: string, now = Date.now()): boolean {
  const db = getDb();
  const h = sha256(token);
  const r = db.prepare('SELECT attempts,expires_at FROM challenges WHERE token_hash=?').get(h) as { attempts: number; expires_at: number } | undefined;
  if (!r || r.expires_at < now) return false;
  if (r.attempts >= 5) { db.prepare('DELETE FROM challenges WHERE token_hash=?').run(h); return false; }
  db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE token_hash=?').run(h);
  return true;
}
export const dropChallenge = (token: string) => getDb().prepare('DELETE FROM challenges WHERE token_hash=?').run(sha256(token));

// ---------- sessions ----------
export interface Session { id: number; csrf: string }

export function createSession(c: Context, now = Date.now()): Session {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const r = db
    .prepare('INSERT INTO sessions(token_hash,csrf,created_at,last_used,expires_at,ua,ip_trunc) VALUES(?,?,?,?,?,?,?)')
    .run(sha256(token), csrf, now, now, now + ABS_LIFETIME, shortUa(c.req.header('user-agent')), truncIp(clientIp(c)));
  setCookie(c, COOKIE, token, { prefix: 'host', httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: ABS_LIFETIME / 1000 });
  return { id: Number(r.lastInsertRowid), csrf };
}

export function currentSession(c: Context, now = Date.now()): Session | null {
  const token = getCookie(c, COOKIE, 'host');
  if (!token || token.length > 100) return null;
  const db = getDb();
  const s = db.prepare('SELECT id,csrf,last_used,expires_at FROM sessions WHERE token_hash=?').get(sha256(token)) as
    | { id: number; csrf: string; last_used: number; expires_at: number } | undefined;
  if (!s) return null;
  if (s.expires_at < now || now - s.last_used > IDLE_LIFETIME) {
    db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
    return null;
  }
  if (now - s.last_used > 60_000) db.prepare('UPDATE sessions SET last_used=? WHERE id=?').run(now, s.id);
  return { id: s.id, csrf: s.csrf };
}

export function destroyCurrent(c: Context) {
  const token = getCookie(c, COOKIE, 'host');
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
  deleteCookie(c, COOKIE, { prefix: 'host', path: '/', secure: true });
}

export const revokeAllSessions = () => getDb().prepare('DELETE FROM sessions').run();

// ---------- first-login TOTP enrollment (seeded accounts have no TOTP yet) ----------
export const hasTotp = () => !!getDb().prepare('SELECT 1 FROM totp WHERE user_id=1').get();

export function challengeAlive(token: string, now = Date.now()): boolean {
  const r = getDb().prepare('SELECT expires_at FROM challenges WHERE token_hash=?').get(sha256(token)) as { expires_at: number } | undefined;
  return !!r && r.expires_at >= now;
}
export const getEnrollSecret = (token: string) =>
  (getDb().prepare('SELECT enroll_secret s FROM challenges WHERE token_hash=?').get(sha256(token)) as { s: string | null } | undefined)?.s ?? null;
export const setEnrollSecret = (token: string, secret: string) =>
  getDb().prepare('UPDATE challenges SET enroll_secret=? WHERE token_hash=?').run(secret, sha256(token));
