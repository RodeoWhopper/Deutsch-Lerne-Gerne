// npm run backup  ->  consistent SQLite copy (online backup API), encrypted with age.
// Needs BACKUP_AGE_RECIPIENT (age public key, "age1...") and the `age` binary.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../src/server/config.ts';

const recipient = process.env.BACKUP_AGE_RECIPIENT;
const outDir = process.env.BACKUP_DIR ?? join(config.dataDir, 'backups');
if (!recipient || !/^age1[0-9a-z]{50,}$/.test(recipient)) {
  console.error('BACKUP_AGE_RECIPIENT (age1... genel anahtar) ayarlı olmalı. Şifresiz yedek alınmaz.');
  process.exit(1);
}
const src = join(config.dataDir, 'app.db');
if (!existsSync(src)) { console.error('veritabanı yok'); process.exit(1); }
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tmp = join(outDir, `.tmp-${stamp}.db`);
const out = join(outDir, `deutsch-${stamp}.db.age`);
const db = new DatabaseSync(src, { readOnly: true });
try {
  await backup(db, tmp);
} finally {
  db.close();
}
const r = spawnSync('age', ['-r', recipient, '-o', out, tmp], { stdio: ['ignore', 'inherit', 'inherit'] });
rmSync(tmp, { force: true });
if (r.status !== 0) { console.error('age şifreleme başarısız'); process.exit(1); }
console.log(`yedek yazıldı: ${out}`);
