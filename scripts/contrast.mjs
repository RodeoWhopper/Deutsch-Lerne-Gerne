// WCAG contrast check for the three themes. Run: node scripts/contrast.mjs
const L = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const THEMES = {
  amber: { bg: '#0E0B05', fg: '#FFB000', dim: '#B07A12', line: '#8A6414', hi: '#FFD27A', der: '#6CB6FF', die: '#FF7A6B', das: '#8FE388' },
  green: { bg: '#07100A', fg: '#5CFF8A', dim: '#34A85C', line: '#2F8A4E', hi: '#B6FFC9', der: '#6CB6FF', die: '#FF8A7A', das: '#D6F05A' },
  dos:   { bg: '#0000AA', fg: '#AAAAAA', dim: '#A0A0E8', line: '#7B7BFF', hi: '#FFFFFF', der: '#55FFFF', die: '#FF6E6E', das: '#55FF55' },
};
let bad = 0;
for (const [name, t] of Object.entries(THEMES)) {
  const rows = [['fg', 4.5], ['dim', 4.5], ['hi', 4.5], ['der', 4.5], ['die', 4.5], ['das', 4.5], ['line', 3]];
  for (const [k, min] of rows) {
    const r = cr(t[k], t.bg);
    const ok = r >= min; if (!ok) bad++;
    console.log(`${name.padEnd(6)} ${k.padEnd(5)} ${t[k]} on ${t.bg}  ${r.toFixed(2)}:1  (min ${min})  ${ok ? 'OK' : 'FAIL'}`);
  }
}
process.exit(bad ? 1 : 0);
