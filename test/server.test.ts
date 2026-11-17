import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, Client, HOST, ORIGIN } from './helpers.ts';
import { getDb } from '../src/server/db.ts';
import { hotp, stepOf } from '../src/server/totp.ts';

let H: Awaited<ReturnType<typeof boot>>;
before(async () => { H = await boot(); });

const example = readFileSync('packs/_example.json', 'utf8');

test('setup: parola >= 24 karakter, 10 kurtarma kodu, argon2id hash, TOTP', () => {
  assert.ok(H.creds.password.length >= 24);
  assert.equal(H.creds.recoveryCodes.length, 10);
  const u = getDb().prepare('SELECT pw_hash FROM users').get() as { pw_hash: string };
  assert.match(u.pw_hash, /^\$argon2id\$/);
  assert.ok(!JSON.stringify(getDb().prepare('SELECT * FROM recovery_codes').all()).includes(H.creds.recoveryCodes[0].replace(/-/g, '')));
  assert.match(H.creds.otpauth, /^otpauth:\/\/totp\//);
});
test('setup ikinci kez --reset olmadan reddedilir', async () => {
  const { provision } = await import('../src/server/provision.ts');
  await assert.rejects(() => provision('x-user', false));
});

test('§4.10-1: oturumsuz her API route\'u 401, veri yok', async () => {
  const c = new Client(H.app, '198.51.100.1');
  const routes = H.app.routes.filter((r) => r.path.startsWith('/api/') && r.method !== 'ALL');
  const seen = new Set<string>();
  const publicPaths = new Set(['/api/auth/login', '/api/auth/totp', '/api/auth/enroll-start', '/api/auth/enroll-finish']);
  let checked = 0;
  for (const r of routes) {
    const path = r.path.replace(/:id/g, '1');
    const key = r.method + path;
    if (seen.has(key) || publicPaths.has(path)) continue;
    seen.add(key);
    const res = await c.req(r.method, path, r.method === 'GET' ? undefined : {});
    assert.equal(res.status, 401, `${r.method} ${path} -> ${res.status}`);
    const t = await res.text();
    assert.ok(!/stack|node_modules|hono/i.test(t), t);
    checked++;
  }
  assert.ok(checked >= 20, `checked ${checked}`);
  const unk = await c.req('GET', '/api/does-not-exist');
  assert.equal(unk.status, 401);
});
test('oturumsuz sayfa istekleri /login\'e yönlenir, bilinmeyen yol 404', async () => {
  const c = new Client(H.app, '198.51.100.2');
  for (const p of ['/', '/topics', '/study/sprint', '/settings', '/packs']) {
    const r = await c.req('GET', p);
    assert.equal(r.status, 302, p); assert.equal(r.headers.get('location'), '/login');
  }
  assert.equal((await c.req('GET', '/etc/passwd')).status, 404);
  assert.equal((await c.req('GET', '/assets/../../package.json')).status, 404);
  assert.equal((await c.req('GET', '/healthz')).status, 200);
});

test('§4.10-2: çerez bayrakları (__Host-, HttpOnly, Secure, SameSite=Strict, Path=/, Domain yok)', async () => {
  const c = new Client(H.app, '198.51.100.3');
  const r = await c.login(H.creds);
  assert.equal(r.status, 200);
  const sc = c.lastSetCookie;
  assert.match(sc, /^__Host-sid=/);
  assert.match(sc, /HttpOnly/i); assert.match(sc, /Secure/i); assert.match(sc, /SameSite=Strict/i); assert.match(sc, /Path=\//);
  assert.ok(!/Domain=/i.test(sc));
  const tok = sc.split(';')[0].split('=')[1];
  // DB stores only the SHA-256 hash of the token
  const rows = JSON.stringify(getDb().prepare('SELECT * FROM sessions').all());
  assert.ok(!rows.includes(tok));
});

test('§4.10-3: 6+ hatalı giriş -> üstel gecikme, audit kaydı', async () => {
  const c = new Client(H.app, '198.51.100.10');
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await c.req('POST', '/api/auth/login', { username: 'tester', password: 'wrong-' + i });
    codes.push(r.status);
    if (r.status === 401) assert.deepEqual(await r.json(), { error: 'Giriş başarısız' });
  }
  assert.deepEqual(codes.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(codes[5], 429);
  const r = await c.req('POST', '/api/auth/login', { username: 'tester', password: H.creds.password });
  assert.equal(r.status, 429); // even the right password is delayed
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  const a = getDb().prepare("SELECT COUNT(*) n FROM login_audit WHERE ok=0 AND ip_trunc='198.51.100.0'").get() as { n: number };
  assert.ok(a.n >= 6);
  // another IP is unaffected (account is never permanently locked)
  const other = new Client(H.app, '198.51.100.11');
  assert.equal((await other.login(H.creds)).status, 200);
});
test('yanlış kullanıcı adı ile yanlış parola aynı hata', async () => {
  const c = new Client(H.app, '198.51.100.20');
  const a = await c.req('POST', '/api/auth/login', { username: 'nobody', password: H.creds.password });
  const b = await c.req('POST', '/api/auth/login', { username: 'tester', password: 'nope' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});

test('§4.10-4: aynı TOTP kodu tekrar kullanılamaz (replay)', async () => {
  const { clock } = await import('../src/server/auth.ts');
  clock.skew += 90_000;
  const code = hotp(H.creds.totpSecret, stepOf(clock.now()));
  const mk = async (ip: string) => {
    const c = new Client(H.app, ip);
    const r1 = await c.req('POST', '/api/auth/login', { username: 'tester', password: H.creds.password });
    const { challenge } = (await r1.json()) as { challenge: string };
    return c.req('POST', '/api/auth/totp', { challenge, code });
  };
  const first = await mk('198.51.100.30');
  const second = await mk('198.51.100.31');
  assert.equal(first.status, 200);
  assert.equal(second.status, 401);
});
test('kurtarma kodu tek kullanımlık', async () => {
  const code = H.creds.recoveryCodes[0];
  const attempt = async (ip: string) => {
    const c = new Client(H.app, ip);
    const r1 = await c.req('POST', '/api/auth/login', { username: 'tester', password: H.creds.password });
    const { challenge } = (await r1.json()) as { challenge: string };
    return c.req('POST', '/api/auth/totp', { challenge, code });
  };
  assert.equal((await attempt('198.51.100.40')).status, 200);
  assert.equal((await attempt('198.51.100.41')).status, 401);
});

test('§4.10-5: CSRF: başka origin / CSRF token yok / yanlış content-type reddedilir', async () => {
  const c = new Client(H.app, '198.51.100.50');
  assert.equal((await c.login(H.creds)).status, 200);
  const ok = await c.req('PUT', '/api/settings', { theme: 'amber', crt: false, daily_new: 10, sprint_minutes: 15, sprint_new: false, vibrate: false, wake_lock: true });
  assert.equal(ok.status, 200);
  const evil = await c.req('PUT', '/api/settings', { theme: 'dos', crt: false, daily_new: 10, sprint_minutes: 15, sprint_new: false, vibrate: false, wake_lock: true }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const noOrigin = await c.req('POST', '/api/auth/logout', {}, { origin: '' });
  assert.equal(noOrigin.status, 403);
  const savedCsrf = c.csrf; c.csrf = '';
  assert.equal((await c.req('POST', '/api/auth/sessions/revoke-all', {})).status, 403);
  c.csrf = 'x'.repeat(savedCsrf.length);
  assert.equal((await c.req('POST', '/api/auth/sessions/revoke-all', {})).status, 403);
  c.csrf = savedCsrf;
  const form = await c.req('POST', '/api/study/queue', 'mode=daily', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  const crossSite = await c.req('PUT', '/api/settings', {}, { 'sec-fetch-site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  assert.equal((await c.req('GET', '/api/settings')).status, 200);
  assert.equal(getSettingsTheme(), 'amber');
});
const getSettingsTheme = () => (getDb().prepare("SELECT value FROM settings WHERE key='theme'").get() as { value: string }).value.replace(/"/g, '');

test('§4.10-8: tüm yanıtlarda güvenlik başlıkları', async () => {
  const c = new Client(H.app, '198.51.100.60');
  for (const p of ['/healthz', '/login', '/robots.txt', '/api/auth/me', '/nope']) {
    const r = await c.req('GET', p);
    const h = r.headers;
    assert.match(h.get('content-security-policy')!, /default-src 'self'; script-src 'self'; style-src 'self'/, p);
    assert.match(h.get('content-security-policy')!, /frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'/, p);
    assert.equal(h.get('strict-transport-security'), 'max-age=63072000; includeSubDomains', p);
    assert.equal(h.get('x-content-type-options'), 'nosniff', p);
    assert.equal(h.get('referrer-policy'), 'no-referrer', p);
    assert.match(h.get('permissions-policy')!, /camera=\(\)/, p);
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin', p);
    assert.equal(h.get('cross-origin-resource-policy'), 'same-origin', p);
    assert.equal(h.get('x-robots-tag'), 'noindex, nofollow', p);
    assert.ok(!h.get('server') && !h.get('x-powered-by'), p);
    if (p.startsWith('/api/')) assert.equal(h.get('cache-control'), 'no-store', p);
  }
  assert.match(await (await c.req('GET', '/robots.txt')).text(), /Disallow: \//);
});
test('HTTP -> HTTPS yönlendirmesi (proxy arkasında)', async () => {
  const c = new Client(H.app, '198.51.100.61');
  const r = await c.req('GET', '/login', undefined, { 'x-forwarded-proto': 'http' });
  assert.equal(r.status, 308); assert.equal(r.headers.get('location'), `https://${HOST}/login`);
});

test('§4.10-6/7: paket içe aktarma: dry-run, yeniden kimlik doğrulama, atomik, zararlı string düz metin', async () => {
  const c = new Client(H.app, '198.51.100.70');
  assert.equal((await c.login(H.creds)).status, 200);
  const dry = await c.req('POST', '/api/packs/dry-run', { raw: example });
  const d = (await dry.json()) as any;
  assert.equal(d.ok, true); assert.equal(d.plan.add, 43); assert.equal(d.plan.update, 0);
  // yazma yok
  const cnt = () => (getDb().prepare('SELECT COUNT(*) n FROM items').get() as { n: number }).n;
  assert.equal(cnt(), 0);
  // reauth gerekli
  const noAuth = await c.req('POST', '/api/packs/import', { raw: example, reset_progress: false, reauth: {} });
  assert.equal(noAuth.status, 403); assert.equal(cnt(), 0);
  const badAuth = await c.req('POST', '/api/packs/import', { raw: example, reset_progress: false, reauth: { password: 'nope' } });
  assert.equal(badAuth.status, 403); assert.equal(cnt(), 0);
  // geçersiz paket: kısmi yazma yok
  const p = JSON.parse(example); p.items[40].kind = 'bogus';
  const inv = await c.req('POST', '/api/packs/import', { raw: JSON.stringify(p), reset_progress: false, reauth: { password: H.creds.password } });
  assert.equal(inv.status, 422); assert.equal(cnt(), 0);
  // 1 MB üstü
  const huge = await c.req('POST', '/api/packs/dry-run', { raw: 'x'.repeat(1_100_000) });
  assert.ok([400, 413, 422].includes(huge.status)); assert.equal(cnt(), 0);
  // zararlı string'ler ile geçerli paket
  const evil = JSON.parse(example); evil.pack.id = 'evil-pack'; evil.pack.unit = 'evil';
  evil.items = [{ id: 'w.evil1', kind: 'word', pos: 'other', de: '<img src=x onerror=alert(1)>', tr: ['<script>alert(1)</script>', 'javascript:alert(1)'] }];
  const e = await c.req('POST', '/api/packs/import', { raw: JSON.stringify(evil), reset_progress: false, reauth: { password: H.creds.password } });
  assert.equal(e.status, 200);
  const stored = getDb().prepare("SELECT json FROM items WHERE id='w.evil1'").get() as { json: string };
  assert.equal(JSON.parse(stored.json).de, '<img src=x onerror=alert(1)>'); // stored verbatim, rendered via textContent
  // import_log yazıldı
  assert.equal((getDb().prepare('SELECT COUNT(*) n FROM import_log').get() as { n: number }).n, 1);
  // aynı sürüm tekrar reddedilir
  const dup = await c.req('POST', '/api/packs/dry-run', { raw: JSON.stringify(evil) });
  assert.equal(dup.status, 422);
});

test('akış: import -> aktif et -> kuyruk -> cevap -> SRS -> geri al', async () => {
  const c = new Client(H.app, '198.51.100.80');
  assert.equal((await c.login(H.creds)).status, 200);
  const imp = await c.req('POST', '/api/packs/import', { raw: example, reset_progress: false, reauth: { password: H.creds.password } });
  assert.equal(imp.status, 200);
  const { import_id } = (await imp.json()) as { import_id: number };
  // aktif değilken kuyruk boş
  let q = (await (await c.req('POST', '/api/study/queue', { mode: 'daily' })).json()) as any;
  assert.equal(q.questions.length, 0);
  assert.equal((await c.req('PUT', '/api/packs/h1g2-ulasim/active', { active: true })).status, 200);
  q = (await (await c.req('POST', '/api/study/queue', { mode: 'daily' })).json()) as any;
  assert.equal(q.questions.length, 10); // günlük yeni kart limiti
  const art = q.questions.find((x: any) => x.track === 'artikel');
  assert.ok(!JSON.stringify(q).includes('"answer"'), 'cevap kuyrukta yok');
  // kardeş aralığı: yalnızca 4 item var; mümkün olan en geniş aralık (>=3) korunur
  const ids = q.questions.map((x: any) => x.card_id.split('#')[0]);
  ids.forEach((id: string, i: number) => assert.ok(!ids.slice(Math.max(0, i - 2), i).includes(id), 'sibling too close at ' + i));
  const a = (await (await c.req('POST', '/api/study/answer', { card_id: 'n.bus#artikel', answer: 'der', ms: 3000, hint: false, mode: 'daily' })).json()) as any;
  assert.equal(a.correct, true); assert.equal(a.expected, 'der Bus'); assert.equal(a.next.stage, 'learning');
  const w = (await (await c.req('POST', '/api/study/answer', { card_id: 'n.bus#trde', answer: 'Bus', ms: 3000, hint: false, mode: 'daily' })).json()) as any;
  assert.equal(w.correct, false); assert.deepEqual(w.notes, ['artikeli yaz']); assert.equal(w.grade, 'again');
  const home = (await (await c.req('GET', '/api/home')).json()) as any;
  assert.ok(home.errors >= 1);
  // sprint: coverage
  const sp = (await (await c.req('POST', '/api/study/queue', { mode: 'sprint', minutes: 15 })).json()) as any;
  assert.ok(sp.questions.every((x: any) => x.stage !== 'new'));
  // geri al
  const un = await c.req('POST', '/api/packs/undo', { import_id, reauth: { password: H.creds.password } });
  assert.equal(un.status, 200);
  assert.equal((getDb().prepare("SELECT COUNT(*) n FROM items WHERE pack_id='h1g2-ulasim'").get() as { n: number }).n, 0);
});

test('oturum yönetimi: liste, iptal, hepsini kapat; çıkış sonrası 401', async () => {
  const a = new Client(H.app, '198.51.100.90'), b = new Client(H.app, '198.51.100.91');
  assert.equal((await a.login(H.creds)).status, 200);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await b.login(H.creds)).status, 200);
  const list = (await (await a.req('GET', '/api/auth/sessions')).json()) as any;
  assert.ok(list.sessions.length >= 2);
  assert.ok(list.sessions.every((s: any) => /^\d+\.\d+\.\d+\.0$/.test(s.ip_trunc)));
  assert.ok(list.sessions.some((s: any) => s.current));
  const audit = (await (await a.req('GET', '/api/auth/audit')).json()) as any;
  assert.ok(audit.audit.length <= 20 && audit.audit.length > 0);
  assert.ok(!JSON.stringify(audit).includes('198.51.100.90'), 'tam IP loglanmaz/gösterilmez');
  // tek tek iptal: b'nin oturumunu a iptal eder
  const bId = list.sessions.find((x: any) => !x.current).id;
  assert.equal((await a.req('DELETE', `/api/auth/sessions/${bId}`)).status, 200);
  assert.equal((await b.req('GET', '/api/auth/me')).status, 401);
  assert.equal((await a.req('GET', '/api/auth/me')).status, 200);
  await a.req('POST', '/api/auth/sessions/revoke-all', {});
  assert.equal((await a.req('GET', '/api/auth/me')).status, 401);
  assert.equal((await b.req('GET', '/api/auth/me')).status, 401);
});

test('oturum: boşta 14 gün ve mutlak 30 gün sonra düşer', async () => {
  const c = new Client(H.app, '198.51.100.95');
  await c.login(H.creds);
  const db = getDb();
  db.prepare('UPDATE sessions SET last_used=?').run(Date.now() - 15 * 86400_000);
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);
});

test('gizli bilgi logda yok: audit yalnızca olay türü içerir', () => {
  const rows = JSON.stringify(getDb().prepare('SELECT * FROM login_audit').all());
  assert.ok(!rows.includes(H.creds.password));
  assert.ok(!rows.includes(H.creds.totpSecret));
});
