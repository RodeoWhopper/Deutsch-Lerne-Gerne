// Integration harness: in-memory DB + Hono app.request with a tiny cookie jar.
import './env.ts';
import { openDb, setDb } from '../src/server/db.ts';
import { hotp, stepOf } from '../src/server/totp.ts';

export const HOST = 'app.test';
export const ORIGIN = `https://${HOST}`;

export async function boot() {
  setDb(openDb(':memory:'));
  const { app } = await import('../src/server/app.ts');
  const { provision } = await import('../src/server/provision.ts');
  const { _resetRateLimits } = await import('../src/server/security.ts');
  const creds = await provision('tester', false);
  return { app, creds, _resetRateLimits };
}

export class Client {
  cookie = '';
  csrf = '';
  lastSetCookie = '';
  app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> };
  ip: string;
  constructor(app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> }, ip = '203.0.113.7') {
    this.app = app;
    this.ip = ip;
  }
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      host: HOST, origin: ORIGIN, 'x-forwarded-for': this.ip, 'x-forwarded-proto': 'https', 'x-forwarded-host': HOST,
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36',
    };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, extra);
    const res = await this.app.request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) { this.lastSetCookie = sc; this.cookie = sc.split(';')[0]; }
    return res;
  }
  async login(creds: { username: string; password: string; totpSecret: string }) {
    const { clock } = await import('../src/server/auth.ts');
    clock.skew += 90_000; // every login uses a fresh TOTP time-step (replay protection is on)
    const now = clock.now();
    const r1 = await this.req('POST', '/api/auth/login', { username: creds.username, password: creds.password });
    if (r1.status !== 200) return r1;
    const { challenge } = (await r1.json()) as { challenge: string };
    const code = hotp(creds.totpSecret, stepOf(now));
    const r2 = await this.req('POST', '/api/auth/totp', { challenge, code });
    if (r2.status === 200) this.csrf = ((await r2.clone().json()) as { csrf: string }).csrf;
    return r2;
  }
}
