// The only allowed inline markup: **bold**. Returns text segments; callers must render via text nodes.
export type Seg = { t: string; b: boolean };
export function parseBold(s: string): Seg[] {
  const out: Seg[] = [];
  const parts = s.split('**');
  // odd number of '**' markers => unbalanced; treat everything as plain text
  if (parts.length % 2 === 0) return [{ t: s, b: false }];
  parts.forEach((p, i) => {
    if (p) out.push({ t: p, b: i % 2 === 1 });
  });
  return out;
}
