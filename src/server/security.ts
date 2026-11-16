import type { Context, MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { config } from './config.ts';
import { getDb } from './db.ts';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export const headers: MiddlewareHandler = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('Content-Security-Policy', CSP);
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('X-Frame-Options', 'DENY');
  if (c.req.path.startsWith('/api/')) h.set('Cache-Control', 'no-store');
};

/** Real client IP. With TRUST_PROXY=n, take the n-th entry from the right of X-Forwarded-For. */
export function clientIp(c: Context): string {
  if (config.trustProxy > 0) {
    const xff = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ip = xff[xff.length - config.trustProxy];
    if (ip) return ip;
  }
  try {
    return getConnInfo(c).remote.address ?? '0.0.0.0';
  } catch {
    return '0.0.0.0';
  }
}

/** Truncated form for display/logs: IPv4 /24, IPv6 /48. */
export function truncIp(ip: string): string {
  if (ip.includes('.') && !ip.includes(':')) return ip.split('.').slice(0, 3).join('.') + '.0';
  if (ip.startsWith('::ffff:') && ip.includes('.')) return truncIp(ip.slice(7));
  return ip.split(':').slice(0, 3).join(':') + '::';
}

export function ipKey(ip: string): string {
  const salt = (getDb().prepare("SELECT value FROM meta WHERE key='ip_salt'").get() as { value: string }).value;
  return sha256(salt + ip).slice(0, 16);
}

export function shortUa(ua: string | undefined): string {
  const u = ua ?? '';
  const os = /Android/.test(u) ? 'Android' : /iPhone|iPad|iOS/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : '?';
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '?';
  return `${br} / ${os}`;
}

/** HTTP -> HTTPS (behind a proxy). /healthz is exempt for container health checks. */
export const httpsOnly: MiddlewareHandler = async (c, next) => {
  if (config.insecureDev || c.req.path === '/healthz') return next();
  const proto = config.trustProxy > 0 ? c.req.header('x-forwarded-proto') : new URL(c.req.url).protocol.replace(':', '');
  if (proto && proto !== 'https') {
    const host = (config.trustProxy > 0 ? c.req.header('x-forwarded-host') : null) ?? c.req.header('host') ?? '';
    return c.redirect(`https://${host}${c.req.path}`, 308);
  }
  return next();
};

function requestHost(c: Context): string {
  return ((config.trustProxy > 0 ? c.req.header('x-forwarded-host') : null) ?? c.req.header('host') ?? '').toLowerCase();
}

/** Mutations: JSON only + Origin must match Host. */
export const mutationGuard: MiddlewareHandler = async (c, next) => {
  const m = c.req.method;
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    const origin = c.req.header('origin');
    let ok = false;
    if (origin) {
      try { ok = new URL(origin).host.toLowerCase() === requestHost(c); } catch { ok = false; }
    }
    const sfs = c.req.header('sec-fetch-site');
    if (!ok || (sfs && sfs !== 'same-origin')) return c.json({ error: 'İstek reddedildi' }, 403);
    const ct = (c.req.header('content-type') ?? '').toLowerCase();
    if (c.req.raw.body !== null && !ct.startsWith('application/json')) return c.json({ error: 'İstek reddedildi' }, 415);
  }
  return next();
};

// ---- rate limit (in-memory fixed window per ip key) ----
const buckets = new Map<string, { n: number; reset: number }>();
export const rateLimit = (name: string, max: number, windowMs = 60_000): MiddlewareHandler => async (c, next) => {
  const key = `${name}:${clientIp(c)}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  if (b.n > max) {
    c.header('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
    return c.json({ error: 'Çok fazla istek' }, 429);
  }
  return next();
};
export const _resetRateLimits = () => buckets.clear();
