// Writes dist/client/sw.js: caches ONLY the hashed app shell (assets/, fonts/, icons/). Never /api/*, never HTML.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = 'dist/client';
const walk = (d) => readdirSync(join(root, d)).flatMap((n) => {
  const rel = join(d, n);
  return statSync(join(root, rel)).isDirectory() ? walk(rel) : ['/' + rel];
});
const files = [...walk('assets'), ...walk('fonts').filter((f) => f.endsWith('.woff2'))].sort();
const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12);
writeFileSync(join(root, 'sw.js'), `'use strict';
const CACHE = 'shell-${version}';
const SHELL = ${JSON.stringify(files)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !SHELL.includes(u.pathname)) return; // everything else: network only
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`);
console.log('sw.js:', files.length, 'dosya, sürüm', version);
