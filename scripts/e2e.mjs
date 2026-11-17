// End-to-end evidence run (Faz 4/5): real Chromium at 390x844, all screens, 3 themes, third-party request count.
// usage: BASE=http://localhost:8099 CREDS=/path/creds.txt node scripts/e2e.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, readFileSync as rf } from 'node:fs';
const require = createRequire('/opt/node-tools/');
const { chromium } = require('playwright');
const { hotp, stepOf } = await import('../src/server/totp.ts');

const BASE = process.env.BASE ?? 'http://localhost:8099';
const creds = readFileSync(process.env.CREDS, 'utf8');
const g = (k) => creds.match(new RegExp(`${k}\\s*:\\s*(\\S+)`))[1];
const user = g('kullanıcı adı'), pass = g('parola'), secret = g('TOTP secret');
const pack = rf('packs/_example.json', 'utf8');
const out = 'screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
const page = await ctx.newPage();
const foreign = []; const failed = []; const consoleErr = [];
page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text()); });
page.on('pageerror', (e) => consoleErr.push('pageerror: ' + e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); failed.push(m); } else console.log('ok  :', m); };

// ---- login ----
await page.goto(BASE + '/login');
await shot('01-login');
await page.fill('#u', user); await page.fill('#p', pass);
await page.click('button[type=submit]');
await page.waitForSelector('#c');
await shot('02-login-totp');
await page.fill('#c', hotp(secret, stepOf(Date.now())));
await page.click('button[type=submit]');
await page.waitForURL(BASE + '/');
ok(true, 'login + TOTP');
await page.waitForSelector('.boot, .kv', { timeout: 5000 });
await shot('03-boot-or-home');
await page.waitForSelector('.kv', { timeout: 5000 });

// ---- import pack via UI ----
await page.goto(BASE + '/packs');
await page.fill('textarea[aria-label="paket JSON"]', pack);
await page.click('text=[ önizle ]');
await page.waitForSelector('.man .kv');
await page.evaluate(() => window.scrollTo(0, 400));
await shot('04-packs-dryrun');
await page.fill('#rp', pass);
await page.click('text=[ yükle ]');
await page.waitForSelector('text=yüklendi');
await page.click('button:has-text("[ ] pasif")');
await page.waitForSelector('button:has-text("[x] aktif")');
await page.evaluate(() => window.scrollTo(0, 0));
await shot('05-packs');
ok(true, 'paket içe aktarma + etkinleştirme (UI)');

// ---- themes x home ----
for (const [t, n] of [['green', '06-home-green'], ['dos', '07-home-dos'], ['amber', '08-home-amber']]) {
  await page.goto(BASE + '/settings');
  await page.click(`button[aria-pressed]:has-text("${t === 'green' ? 'yeşil' : t === 'dos' ? 'DOS' : 'amber'}")`);
  await page.waitForFunction((x) => document.documentElement.dataset.theme === x, t);
  if (t === 'dos') await shot('06b-settings-dos');
  await page.goto(BASE + '/');
  await page.waitForSelector('.kv');
  await shot(n);
}

// ---- study: daily first (introduces cards), then sprint over what is now active ----
const studyShots = { choice: false, type: false, result: false };
async function session(url, tag, maxCards = 80) {
  await page.goto(BASE + url);
  await page.waitForSelector('.qprompt, h1', { timeout: 8000 });
  let n = 0;
  for (let i = 0; i < maxCards; i++) {
    if (await page.locator('h1:has-text("özet"), h1:has-text("kuyruk boş")').count()) break;
    await page.waitForSelector('.qprompt, h1', { timeout: 5000 });
    if (await page.locator('h1:has-text("özet"), h1:has-text("kuyruk boş")').count()) break;
    const hasInput = await page.locator('.inputline input').count();
    const hasOpt = await page.locator('.opt').count();
    const hasShow = await page.locator('text=[ cevabı göster ]').count();
    if (hasOpt && !studyShots.choice) { await shot('09-study-choice'); studyShots.choice = true; }
    if (hasInput && !studyShots.type) { await shot('10-study-type'); studyShots.type = true; }
    if (hasInput) { await page.fill('.inputline input', i % 3 === 0 ? 'falsch' : 'der Bus'); await page.keyboard.press('Enter'); }
    else if (hasShow) { await page.click('text=[ cevabı göster ]'); await page.click('.opt >> nth=0'); }
    else { await page.click('.opt >> nth=' + (i % 2)); }
    await page.waitForSelector('.stamp'); await page.waitForTimeout(260);
    if (!studyShots.result && i > 2) { await shot('11-study-result'); studyShots.result = true; }
    await page.click('text=devam');
    n++;
  }
  await page.waitForSelector('h1:has-text("özet"), h1:has-text("kuyruk boş")', { timeout: 8000 });
  await shot(tag);
  return n;
}
const nDaily = await session('/study/daily', '12a-daily-summary');
ok(nDaily >= 10, `günlük oturum (${nDaily} kart cevaplandı)`);
const nSprint = await session('/study/sprint?m=15', '12-sprint-summary');
ok(nSprint > 5, `sprint oturumu (${nSprint} kart cevaplandı)`);
await page.goto(BASE + '/study/mini'); await page.waitForTimeout(600); await shot('12b-mini');
await page.goto(BASE + '/study/errors'); await page.waitForTimeout(600); await shot('12c-errors-session');

// ---- other screens ----
for (const [p, name] of [['/topics', '13-topics'], ['/errors', '14-errors'], ['/stats', '15-stats'], ['/settings', '16-settings'], ['/', '17-home']]) {
  await page.goto(BASE + p);
  await page.waitForTimeout(500);
  await shot(name);
}
await page.goto(BASE + '/errors');
await page.click('text=[ zorlanılan kartların özeti ]'); await page.waitForTimeout(300); await shot('14b-errors-export');

// ---- CRT on + typed result view in dos theme for visual check ----
await page.goto(BASE + '/settings');
await page.click('button:has-text("CRT efekti")');
await page.goto(BASE + '/');
await page.waitForSelector('.kv'); await shot('18-crt-on');
await page.goto(BASE + '/settings'); await page.click('button:has-text("CRT efekti")');

// ---- horizontal overflow / touch target audit on key screens ----
for (const p of ['/', '/topics', '/errors', '/packs', '/stats', '/settings', '/study/sprint']) {
  await page.goto(BASE + p); await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 0, `yatay taşma yok: ${p} (${over})`);
}
ok(foreign.length === 0, `üçüncü taraf istek sayısı = ${foreign.length} ${foreign.join(',')}`);
ok(consoleErr.length === 0, `konsol hatası yok ${consoleErr.join(' | ')}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
