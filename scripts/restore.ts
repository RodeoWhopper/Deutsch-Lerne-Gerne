// npm run restore -- <backup.db.age> <age-identity-file>
// Decrypts, verifies integrity + schema, then swaps it in (the old DB is kept as app.db.pre-restore-<ts>).
// STOP the app before restoring.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/server/config.ts';

const [file, identity] = process.argv.slice(2);
if (!file || !identity) { console.error('kullanım: npm run restore -- <yedek.db.age> <age-kimlik-dosyası>'); process.exit(2); }
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const tmp = join(config.dataDir, '.restore-tmp.db');
const r = spawnSync('age', ['-d', '-i', identity, '-o', tmp, file], { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) { rmSync(tmp, { force: true }); console.error('şifre çözme başarısız'); process.exit(1); }
const db = new DatabaseSync(tmp, { readOnly: true });
const ic = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
const need = ['users', 'totp', 'sessions', 'items', 'cards', 'card_state', 'reviews', 'packs'];
const users = tables.includes('users') ? (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n : 0;
db.close();
if (ic !== 'ok' || need.some((t) => !tables.includes(t)) || users !== 1) {
  rmSync(tmp, { force: true });
  console.error(`yedek geçersiz (integrity=${ic}, kullanıcı=${users})`); process.exit(1);
}
const live = join(config.dataDir, 'app.db');
if (existsSync(live)) copyFileSync(live, `${live}.pre-restore-${Date.now()}`);
for (const ext of ['-wal', '-shm']) rmSync(live + ext, { force: true });
renameSync(tmp, live);
console.log('geri yüklendi. Uygulamayı yeniden başlat; tüm oturumları kapatmak için: npm run reset-credentials (isteğe bağlı).');
