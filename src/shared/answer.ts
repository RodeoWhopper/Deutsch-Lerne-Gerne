// Answer checking (spec §5.3). Pure, unit-tested.

export const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/gu, ' ');

const TR_ASCII: Record<string, string> = { ç: 'c', ş: 's', ğ: 'g', ı: 'i', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u' };
/** Turkish-aware lowercase: I→ı, İ→i. Never use plain toLowerCase() for Turkish. */
export const trLower = (s: string) => norm(s).toLocaleLowerCase('tr');
export const trFold = (s: string) => trLower(s).replace(/[çşğıöüâîû]/gu, (c) => TR_ASCII[c]);

export const deLower = (s: string) => norm(s).toLocaleLowerCase('de');
const DE_EXP: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
export const deExpand = (s: string) => deLower(s).replace(/[äöüß]/gu, (c) => DE_EXP[c]);

const stripEnd = (s: string) => s.replace(/[\s.!?]+$/u, '');

export interface Check {
  correct: boolean;
  caseOnly: boolean; // correct but capitalization wrong (→ hard)
  notes: string[]; // Turkish UI notes
}

export interface DeOpts {
  ignoreEndPunct?: boolean;
  /** capitalization only matters when true (nouns); otherwise case-insensitive & penalised as hard */
  capitalized?: boolean;
}

/** Compare a German string against one expected candidate. */
function deOne(input: string, exp: string, o: DeOpts): Check | null {
  let a = norm(input);
  let b = norm(exp);
  if (o.ignoreEndPunct) { a = stripEnd(a); b = stripEnd(b); }
  if (a === b) return { correct: true, caseOnly: false, notes: [] };
  if (deLower(a) === deLower(b)) {
    return { correct: true, caseOnly: true, notes: [o.capitalized ? "Almanca'da isimler büyük harfle başlar" : 'büyük/küçük harf'] };
  }
  if (deExpand(a) === deExpand(b)) {
    const diff = [...b].filter((c) => /[äöüßÄÖÜ]/u.test(c)).join('');
    const capsWrong = a.charAt(0) !== b.charAt(0) && deLower(a.charAt(0)) === deLower(b.charAt(0)) && o.capitalized;
    return {
      correct: true,
      caseOnly: !!capsWrong,
      notes: [`kabul edildi, doğrusu: ${diff}`].concat(capsWrong ? ["Almanca'da isimler büyük harfle başlar"] : []),
    };
  }
  return null;
}

export function checkGerman(input: string, accepted: string[], o: DeOpts = {}): Check {
  let best: Check | null = null;
  for (const exp of accepted) {
    const r = deOne(input, exp, o);
    if (!r) continue;
    if (!best || (best.caseOnly && !r.caseOnly)) best = r;
  }
  return best ?? { correct: false, caseOnly: false, notes: [] };
}

export function checkNoun(input: string, article: string, de: string): Check {
  const s = norm(input);
  const m = s.match(/^(der|die|das)\s+(.+)$/iu);
  if (!m) {
    return { correct: false, caseOnly: false, notes: ['artikeli yaz'] };
  }
  if (m[1].toLowerCase() !== article) {
    return { correct: false, caseOnly: false, notes: [] };
  }
  const r = checkGerman(m[2], [de], { capitalized: true });
  return r;
}

export function checkTurkish(input: string, variants: string[]): Check {
  const a = trLower(input);
  const f = trFold(input);
  for (const v of variants) if (trLower(v) === a) return { correct: true, caseOnly: false, notes: [] };
  for (const v of variants) {
    if (trFold(v) === f) return { correct: true, caseOnly: false, notes: [`kabul edildi, doğrusu: ${v}`] };
  }
  return { correct: false, caseOnly: false, notes: [] };
}
