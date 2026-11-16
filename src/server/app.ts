import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { getDb, tx } from './db.ts';
import {
  headers, httpsOnly, mutationGuard, rateLimit,
} from './security.ts';
import {
  audit, checkPassword, checkPasswordOnly, checkSecondFactor, createChallenge, createSession, currentSession, destroyCurrent,
  dropChallenge, recordFailure, recordSuccess, revokeAllSessions, takeChallengeAttempt, throttleWait, type Session,
} from './auth.ts';
import { answer, buildQueue } from './engine.ts';
import { loadCard } from './store.ts';
import { analyze, apply, undoImport } from './importer.ts';
import { getSettings, putSettings, settingsSchema } from './settings.ts';
import { errorsView, home, leechExport, stats, tomorrowCount } from './stats.ts';
import { TRACKS } from '../shared/cards.ts';
import { MAX_PACK_BYTES } from '../shared/pack.ts';

type Env = { Variables: { session: Session } };
export const app = new Hono<Env>();

const FAIL = { error: 'Giriş başarısız' };
const PAGES = [/^\/$/, /^\/study\/(daily|sprint|topic|errors|mini)$/, /^\/topics$/, /^\/errors$/, /^\/packs$/, /^\/stats$/, /^\/settings$/];
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
};

app.use('*', httpsOnly);
app.use('*', headers);
app.onError((err, c) => {
  // never leak stack traces / versions
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled', name: (err as Error)?.name }));
  return c.json({ error: 'Sunucu hatası' }, 500);
});
app.notFound((c) => c.text('Not found', 404));

app.get('/healthz', (c) => c.text('ok'));
app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

// ---------------- static ----------------
async function sendFile(c: Context, rel: string, cache: string) {
  const root = resolve(config.distDir);
  const full = resolve(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return c.text('Not found', 404);
  try {
    const st = await stat(full);
    if (!st.isFile()) return c.text('Not found', 404);
    const buf = await readFile(full);
    return new Response(buf, { headers: { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream', 'Cache-Control': cache } });
  } catch {
    return c.text('Not found', 404);
  }
}
app.get('/assets/*', (c) => sendFile(c, c.req.path.slice(1), 'public, max-age=31536000, immutable'));
app.get('/fonts/*', (c) => sendFile(c, c.req.path.slice(1), 'public, max-age=31536000, immutable'));
app.get('/icons/*', (c) => sendFile(c, c.req.path.slice(1), 'public, max-age=86400'));
app.get('/manifest.webmanifest', (c) => sendFile(c, 'manifest.webmanifest', 'no-cache'));
app.get('/sw.js', (c) => sendFile(c, 'sw.js', 'no-cache'));

// ---------------- pages (deny by default) ----------------
app.get('/login', async (c) => (currentSession(c) ? c.redirect('/') : await sendFile(c, 'index.html', 'no-store')));
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();
  if (!PAGES.some((r) => r.test(c.req.path))) return c.text('Not found', 404);
  if (!currentSession(c)) return c.redirect('/login');
  return sendFile(c, 'index.html', 'no-store');
});

// ---------------- API ----------------
const api = new Hono<Env>();
api.use('*', mutationGuard);
// strict limiter only on the credential endpoints; the failure counter (§4.4) covers everything else
api.use('/auth/login', rateLimit('auth-login', 20));
api.use('/auth/totp', rateLimit('auth-totp', 20));
api.use('*', rateLimit('api', 400));

const loginBody = z.strictObject({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
const totpBody = z.strictObject({ challenge: z.string().min(10).max(100), code: z.string().min(6).max(24) });

async function json<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T> | null> {
  try {
    const r = schema.safeParse(await c.req.json());
    return r.success ? r.data : null;
  } catch { return null; }
}

function blocked(c: Context) {
  const wait = throttleWait(c);
  if (wait > 0) {
    audit(c, 'blocked', false);
    c.header('Retry-After', String(wait));
    return c.json({ error: 'Çok fazla deneme, bekle', retry_after: wait }, 429);
  }
  return null;
}

api.post('/auth/login', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Giriş başarısız' }, 413) }), async (c) => {
  const b = await json(c, loginBody);
  const bl = blocked(c);
  if (bl) return bl;
  const ok = b ? await checkPassword(b.username, b.password) : false;
  if (!ok) { recordFailure(c); audit(c, 'password', false); return c.json(FAIL, 401); }
  audit(c, 'password', true);
  return c.json({ challenge: createChallenge() });
});

api.post('/auth/totp', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Giriş başarısız' }, 413) }), async (c) => {
  const b = await json(c, totpBody);
  const bl = blocked(c);
  if (bl) return bl;
  if (!b || !takeChallengeAttempt(b.challenge)) { recordFailure(c); audit(c, 'totp', false); return c.json(FAIL, 401); }
  const kind = checkSecondFactor(b.code);
  if (!kind) { recordFailure(c); audit(c, 'totp', false); return c.json(FAIL, 401); }
  dropChallenge(b.challenge);
  recordSuccess(c);
  const s = createSession(c);
  audit(c, kind === 'recovery' ? 'recovery' : 'login', true);
  return c.json({ ok: true, csrf: s.csrf, recovery_used: kind === 'recovery' });
});

// ---- everything below requires a session ----
api.use('*', async (c, next) => {
  const s = currentSession(c);
  if (!s) return c.json({ error: 'Yetkisiz' }, 401);
  c.set('session', s);
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const tok = c.req.header('x-csrf-token') ?? '';
    const a = Buffer.from(tok), b = Buffer.from(s.csrf);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'İstek reddedildi' }, 403);
  }
  return next();
});
api.use('*', bodyLimit({ maxSize: 65_536, onError: (c) => c.json({ error: 'Gövde çok büyük' }, 413) }));

api.get('/auth/me', (c) => {
  const u = getDb().prepare('SELECT username FROM users WHERE id=1').get() as { username: string };
  return c.json({ ok: true, csrf: c.get('session').csrf, user: u.username, settings: getSettings() });
});
api.post('/auth/logout', (c) => { destroyCurrent(c); return c.json({ ok: true }); });

api.get('/auth/sessions', (c) => {
  const cur = c.get('session').id;
  const rows = getDb().prepare('SELECT id,created_at,last_used,ua,ip_trunc FROM sessions ORDER BY last_used DESC').all() as any[];
  return c.json({ sessions: rows.map((r) => ({ ...r, current: r.id === cur })) });
});
api.delete('/auth/sessions/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Geçersiz' }, 400);
  getDb().prepare('DELETE FROM sessions WHERE id=?').run(id);
  return c.json({ ok: true });
});
api.post('/auth/sessions/revoke-all', (c) => { revokeAllSessions(); return c.json({ ok: true }); });
api.get('/auth/audit', (c) => {
  const rows = getDb().prepare('SELECT at,ip_trunc,ua,event,ok FROM login_audit ORDER BY id DESC LIMIT 20').all();
  return c.json({ audit: rows });
});

// ---- study ----
const queueBody = z.strictObject({
  mode: z.enum(['daily', 'sprint', 'topic', 'errors', 'mini']),
  track: z.enum(TRACKS as [string, ...string[]]).optional(),
  unit: z.string().regex(/^[a-z0-9-]{2,32}$/).optional(),
  minutes: z.union([z.literal(10), z.literal(15), z.literal(20)]).optional(),
});
api.post('/study/queue', async (c) => {
  const b = await json(c, queueBody);
  if (!b) return c.json({ error: 'Geçersiz istek' }, 400);
  return c.json(buildQueue(b as any));
});
const answerBody = z.strictObject({
  card_id: z.string().min(5).max(120),
  answer: z.string().max(300),
  ms: z.number().min(0).max(3_600_000),
  hint: z.boolean(),
  mode: z.enum(['daily', 'sprint', 'topic', 'errors', 'mini']),
});
api.post('/study/answer', async (c) => {
  const b = await json(c, answerBody);
  if (!b) return c.json({ error: 'Geçersiz istek' }, 400);
  try { return c.json(answer(b)); } catch { return c.json({ error: 'Kart bulunamadı' }, 404); }
});
api.post('/study/reveal', async (c) => {
  const b = await json(c, z.strictObject({ card_id: z.string().min(5).max(120) }));
  const row = b ? loadCard(b.card_id) : null;
  if (!row || row.item.kind !== 'grammar' || row.item.format !== 'qa') return c.json({ error: 'Geçersiz istek' }, 400);
  return c.json({ expected: row.item.answer, explain: row.item.explain ?? null });
});
api.get('/study/tomorrow', (c) => c.json({ n: tomorrowCount() }));

// ---- views ----
api.get('/home', (c) => c.json(home()));
api.get('/stats', (c) => c.json(stats()));
api.get('/errors', (c) => c.json(errorsView()));
api.get('/errors/export', (c) => c.json({ text: leechExport() }));

// ---- settings ----
api.get('/settings', (c) => c.json(getSettings()));
api.put('/settings', async (c) => {
  const b = await json(c, settingsSchema);
  if (!b) return c.json({ error: 'Geçersiz ayar' }, 400);
  putSettings(b);
  return c.json(getSettings());
});

// ---- re-authentication for sensitive operations ----
const reauthSchema = z.strictObject({ password: z.string().min(1).max(256).optional(), totp: z.string().min(6).max(24).optional() });
async function reauth(c: Context, r: z.infer<typeof reauthSchema> | undefined): Promise<Response | null> {
  const bl = blocked(c);
  if (bl) return bl;
  let ok = false;
  if (r?.password) ok = await checkPasswordOnly(r.password);
  else if (r?.totp) ok = checkSecondFactor(r.totp) !== null;
  if (!ok) { recordFailure(c); audit(c, 'reauth', false); return c.json({ error: 'Doğrulama başarısız' }, 403); }
  return null;
}

// ---- packs ----
const rawBody = z.strictObject({ raw: z.string().min(2).max(MAX_PACK_BYTES + 1000) });
const importBody = z.strictObject({ raw: z.string().min(2).max(MAX_PACK_BYTES + 1000), reset_progress: z.boolean(), reauth: reauthSchema });
const big = bodyLimit({ maxSize: MAX_PACK_BYTES + 20_000, onError: (c) => c.json({ error: 'Paket 1 MB sınırını aşıyor' }, 413) });

api.get('/packs', (c) => {
  const rows = getDb().prepare(`SELECT p.id,p.title,p.version,p.level,p.taught_on,p.unit,p.active,
      (SELECT COUNT(*) FROM items i WHERE i.pack_id=p.id AND i.retired=0) items,
      (SELECT COUNT(*) FROM items i WHERE i.pack_id=p.id AND i.retired=1) retired
    FROM packs p ORDER BY p.taught_on, p.id`).all();
  const log = getDb().prepare('SELECT id,at,pack_id,version,sha256,added,updated,unchanged,retired,reset,undone_at FROM import_log ORDER BY id DESC LIMIT 30').all() as any[];
  const last = getDb().prepare('SELECT id FROM import_log WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
  return c.json({ packs: rows, log: log.map((l) => ({ ...l, sha256: l.sha256.slice(0, 12), undoable: l.id === last?.id })) });
});
api.post('/packs/dry-run', big, async (c) => {
  const b = await json(c, rawBody);
  if (!b) return c.json({ ok: false, errors: ['istek geçersiz'] }, 400);
  const a = analyze(b.raw);
  if (!a.ok) return c.json({ ok: false, errors: a.errors }, 422);
  const p = a.plan;
  return c.json({ ok: true, plan: { ...p, add: p.add.length, update: p.update.length, unchanged: p.unchanged.length, restore: p.restore.length, retire: p.retire.length, answer_changed: p.answer_changed } });
});
api.post('/packs/import', big, async (c) => {
  const b = await json(c, importBody);
  if (!b) return c.json({ ok: false, errors: ['istek geçersiz'] }, 400);
  const bad = await reauth(c, b.reauth);
  if (bad) return bad;
  const r = apply(b.raw, { resetProgress: b.reset_progress });
  if (!r.ok) return c.json({ ok: false, errors: r.errors }, 422);
  return c.json({ ok: true, import_id: r.import_id });
});
api.post('/packs/undo', async (c) => {
  const b = await json(c, z.strictObject({ import_id: z.number().int(), reauth: reauthSchema }));
  if (!b) return c.json({ error: 'Geçersiz istek' }, 400);
  const bad = await reauth(c, b.reauth);
  if (bad) return bad;
  const r = undoImport(b.import_id);
  return c.json(r, r.ok ? 200 : 409);
});
api.put('/packs/:id/active', async (c) => {
  const b = await json(c, z.strictObject({ active: z.boolean() }));
  const id = c.req.param('id');
  if (!b || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) return c.json({ error: 'Geçersiz istek' }, 400);
  const r = getDb().prepare('UPDATE packs SET active=? WHERE id=?').run(b.active ? 1 : 0, id);
  return c.json({ ok: r.changes > 0 });
});

// ---- progress export / import ----
api.get('/progress/export', (c) => {
  const db = getDb();
  const data = {
    standard: 'deutsch-progress/1',
    exported_at: Date.now(),
    settings: getSettings(),
    packs: db.prepare('SELECT id,version,active FROM packs').all(),
    card_state: db.prepare('SELECT * FROM card_state').all(),
    reviews: db.prepare('SELECT card_id,at,grade,correct,ms,mode,track,qk,hint,was_due FROM reviews').all(),
  };
  return c.json(data);
});
const num = z.number().finite();
const progressBody = z.strictObject({
  reauth: reauthSchema,
  data: z.strictObject({
    standard: z.literal('deutsch-progress/1'),
    exported_at: num,
    settings: settingsSchema,
    packs: z.array(z.strictObject({ id: z.string().max(64), version: num, active: num })).max(500),
    card_state: z.array(z.strictObject({
      card_id: z.string().max(120), ease: num.min(1.3).max(5), interval_days: num.min(0).max(36500), reps: num.min(0), lapses: num.min(0),
      due: num, stage: z.enum(['new', 'learning', 'review', 'relearning']), step: num.min(0).max(5), streak: num.min(0),
      last_review: num.nullable(), introduced_day: num.nullable(),
    })).max(20000),
    reviews: z.array(z.strictObject({
      card_id: z.string().max(120), at: num, grade: z.enum(['again', 'hard', 'good', 'easy']), correct: num, ms: num, mode: z.string().max(12),
      track: z.string().max(16), qk: z.string().max(12), hint: num, was_due: num,
    })).max(200000),
  }),
});
api.post('/progress/import', bodyLimit({ maxSize: 20_000_000, onError: (c) => c.json({ error: 'Çok büyük' }, 413) }), async (c) => {
  const b = await json(c, progressBody);
  if (!b) return c.json({ error: 'Geçersiz ilerleme dosyası' }, 400);
  const bad = await reauth(c, b.reauth);
  if (bad) return bad;
  const db = getDb();
  const d = b.data;
  tx(db, () => {
    putSettings(d.settings);
    const known = db.prepare('SELECT 1 FROM cards WHERE id=?');
    const up = db.prepare('UPDATE card_state SET ease=?,interval_days=?,reps=?,lapses=?,due=?,stage=?,step=?,streak=?,last_review=?,introduced_day=? WHERE card_id=?');
    for (const s of d.card_state) if (known.get(s.card_id)) up.run(s.ease, s.interval_days, s.reps, s.lapses, s.due, s.stage, s.step, s.streak, s.last_review, s.introduced_day, s.card_id);
    db.prepare('DELETE FROM reviews').run();
    const ins = db.prepare('INSERT INTO reviews(card_id,at,grade,correct,ms,mode,track,qk,hint,was_due) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (const r of d.reviews) ins.run(r.card_id, r.at, r.grade, r.correct ? 1 : 0, r.ms, r.mode, r.track, r.qk, r.hint ? 1 : 0, r.was_due ? 1 : 0);
    const pk = db.prepare('UPDATE packs SET active=? WHERE id=?');
    for (const p of d.packs) pk.run(p.active ? 1 : 0, p.id);
  });
  return c.json({ ok: true });
});

app.route('/api', api);
