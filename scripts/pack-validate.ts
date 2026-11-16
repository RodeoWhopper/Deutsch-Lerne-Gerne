import { readFileSync } from 'node:fs';
import { parsePack } from '../src/shared/pack.ts';

const file = process.argv[2];
if (!file) { console.error('kullanım: npm run pack:validate <dosya.json>'); process.exit(2); }
let raw: string;
try { raw = readFileSync(file, 'utf8'); } catch { console.error('dosya okunamadı'); process.exit(2); }
const r = parsePack(raw);
if (!r.ok) {
  console.error(`GEÇERSİZ (${r.errors.length} hata):`);
  r.errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log(`GEÇERLİ: ${r.pack.pack.id} v${r.pack.pack.version}, ${r.pack.items.length} item, ${r.retire.length} retire`);
