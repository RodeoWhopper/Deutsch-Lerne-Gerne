// Item -> cards (spec §7.3), question building and answer evaluation.
import type { Item } from './pack.ts';
import { checkGerman, checkNoun, checkTurkish, norm, type Check } from './answer.ts';
import type { Stage } from './srs.ts';

export type Track = 'artikel' | 'tr-de' | 'de-tr' | 'gramer' | 'fiil' | 'edat-baglac';
export const TRACKS: Track[] = ['artikel', 'tr-de', 'de-tr', 'gramer', 'fiil', 'edat-baglac'];

export interface CardDef { variant: string; track: Track }
export const cardId = (itemId: string, variant: string) => `${itemId}#${variant}`;
export const splitCardId = (id: string) => {
  const i = id.lastIndexOf('#');
  return { itemId: id.slice(0, i), variant: id.slice(i + 1) };
};

export function cardsFor(item: Item): CardDef[] {
  switch (item.kind) {
    case 'noun':
      return [
        { variant: 'artikel', track: 'artikel' },
        { variant: 'trde', track: 'tr-de' },
        { variant: 'detr', track: 'de-tr' },
      ];
    case 'word': {
      const out: CardDef[] = [
        { variant: 'trde', track: 'tr-de' },
        { variant: 'detr', track: 'de-tr' },
      ];
      if (item.forms) for (const k of Object.keys(item.forms)) out.push({ variant: `form:${k}`, track: 'gramer' });
      return out;
    }
    case 'verb_case': {
      const out: CardDef[] = [{ variant: 'case', track: 'fiil' }];
      if (item.cloze) out.push({ variant: 'cloze', track: 'fiil' });
      out.push({ variant: 'detr', track: 'de-tr' });
      return out;
    }
    case 'prep':
      return [{ variant: 'case', track: 'edat-baglac' }, { variant: 'detr', track: 'de-tr' }];
    case 'conj':
      return [{ variant: 'vpos', track: 'edat-baglac' }, { variant: 'detr', track: 'de-tr' }];
    case 'grammar':
      return [{ variant: 'main', track: 'gramer' }];
    case 'phrase':
      return [{ variant: 'trde', track: 'tr-de' }, { variant: 'detr', track: 'de-tr' }];
  }
}

/** Fields whose change resets progress (spec §7.4). */
export function answerSignature(item: Item): string {
  const i = item as Record<string, unknown>;
  return JSON.stringify([i.kind, i.de, i.article, i.answer, i.case, i.verb_position, i.text, i.accept, i.forms, i.cloze, i.choices]);
}

export const CASE_LABEL: Record<string, string> = { akk: 'Akkusativ', dat: 'Dativ', both: 'Akk. + Dat.', gen: 'Genitiv', wechsel: 'Wechsel' };
export const VPOS_LABEL: Record<string, string> = { end: 'sona gider', second: '2. sırada kalır', none: 'etkisiz' };
const PRONOUN: Record<string, string> = { ich: 'ich', du: 'du', er: 'er/sie/es', wir: 'wir', ihr: 'ihr', sie: 'sie/Sie' };

export type QKind = 'choice' | 'type' | 'selfcheck';
export interface Question {
  card_id: string;
  track: Track;
  unit: string;
  kind: QKind;
  label: string; // small instruction line (Turkish)
  prompt: string; // main line; may contain **bold**
  choices?: string[];
  lang?: 'de' | 'tr';
  placeholder?: string;
  hint?: string;
  stage: Stage;
  /** rough seconds estimate used for sprint budgeting */
  est: number;
}

export interface BuildCtx {
  stage: Stage;
  interval_days: number;
  unit: string;
  /** distractor Turkish meanings for de-tr, same kind & unit preferred */
  distractors: (item: Item, n: number) => string[];
  rng: () => number;
}

const shuffle = <T,>(a: T[], rng: () => number): T[] => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

const blank = (t: string) => t.replace(/\{\{[^{}]+\}\}/, '___');
const inner = (t: string) => (t.match(/\{\{([^{}]+)\}\}/) ?? [, ''])[1] as string;
const fill = (t: string, v: string) => t.replace(/\{\{[^{}]+\}\}/, v);
const hintOf = (s: string) => s.replace(/^(der|die|das)\s+/iu, '').replace(/(?<=.)./gu, (c) => (c === ' ' ? ' ' : '_'));

export function deDisplay(item: Item): string {
  return item.kind === 'noun' ? `${item.article} ${item.de}` : (item as { de: string }).de;
}

export function buildQuestion(item: Item, variant: string, ctx: BuildCtx): Question {
  const track = cardsFor(item).find((c) => c.variant === variant)?.track;
  if (!track) throw new Error(`unknown variant ${variant} for ${item.id}`);
  const base = { card_id: cardId(item.id, variant), track, unit: ctx.unit, stage: ctx.stage };
  const choiceMode = ctx.stage !== 'review' || ctx.interval_days < 3;

  if (variant === 'artikel' && item.kind === 'noun') {
    return { ...base, kind: 'choice', label: 'artikel?', prompt: item.de, choices: ['der', 'die', 'das'], est: 5 };
  }
  if (variant === 'trde') {
    const tr = (item as { tr: string[] }).tr.join(' / ');
    const isNoun = item.kind === 'noun';
    return {
      ...base, kind: 'type', lang: 'de', est: 15,
      label: isNoun ? 'almanca yaz (artikel dahil)' : 'almanca yaz',
      prompt: tr,
      placeholder: isNoun ? 'der/die/das …' : '',
      hint: hintOf(deDisplay(item)),
    };
  }
  if (variant === 'detr') {
    const it = item as { tr: string[] };
    const shown = deDisplay(item);
    const wrong = choiceMode ? ctx.distractors(item, 3) : [];
    if (choiceMode && wrong.length >= 3) {
      return { ...base, kind: 'choice', label: 'türkçesi?', prompt: shown, choices: shuffle([it.tr[0], ...wrong], ctx.rng), est: 8 };
    }
    return { ...base, kind: 'type', lang: 'tr', label: 'türkçesini yaz', prompt: shown, hint: hintOf(it.tr[0]), est: 15 };
  }
  if (variant === 'case' && item.kind === 'verb_case') {
    return {
      ...base, kind: 'choice', label: 'hangi hâl?', est: 8,
      prompt: `${item.de}  (${item.tr[0]})`,
      choices: [CASE_LABEL.akk, CASE_LABEL.dat, CASE_LABEL.both],
    };
  }
  if (variant === 'case' && item.kind === 'prep') {
    return {
      ...base, kind: 'choice', label: 'hangi hâl?', est: 8,
      prompt: `${item.de}  (${item.tr[0]})`,
      choices: [CASE_LABEL.akk, CASE_LABEL.dat, CASE_LABEL.gen, CASE_LABEL.wechsel],
    };
  }
  if (variant === 'vpos' && item.kind === 'conj') {
    return {
      ...base, kind: 'choice', label: 'fiil nerede?', est: 8,
      prompt: `${item.de}  (${item.tr[0]})`,
      choices: [VPOS_LABEL.end, VPOS_LABEL.second, VPOS_LABEL.none],
    };
  }
  if (variant === 'cloze' && item.kind === 'verb_case' && item.cloze) {
    return { ...base, kind: 'type', lang: 'de', label: 'boşluğu doldur', prompt: blank(item.cloze), hint: hintOf(inner(item.cloze)), est: 14 };
  }
  if (variant.startsWith('form:') && item.kind === 'word' && item.forms) {
    const k = variant.slice(5) as keyof typeof item.forms;
    return {
      ...base, kind: 'type', lang: 'de', label: 'çekimle', est: 12,
      prompt: `${item.de}: ${PRONOUN[k] ?? k} ___`,
      hint: hintOf(item.forms[k] ?? ''),
    };
  }
  if (variant === 'main' && item.kind === 'grammar') {
    if (item.format === 'mcq') {
      return { ...base, kind: 'choice', label: 'doğru seçenek?', prompt: item.prompt, choices: shuffle(item.choices, ctx.rng), est: 9 };
    }
    if (item.format === 'cloze') {
      return { ...base, kind: 'type', lang: 'de', label: 'boşluğu doldur', prompt: blank(item.text), hint: hintOf(inner(item.text)), est: 15 };
    }
    return { ...base, kind: 'selfcheck', label: 'kendin kontrol et', prompt: item.prompt, est: 12 };
  }
  throw new Error(`cannot build ${item.id}#${variant}`);
}

export interface Eval extends Check {
  expected: string;
  userLine: string;
  expectedLine: string;
  reveal: { explain?: string; example?: { de: string; tr: string }; trap?: string; note?: string; use?: string; article?: string };
}

const labelKey = (map: Record<string, string>, v: string) => Object.keys(map).find((k) => map[k] === v);

export function evaluate(item: Item, variant: string, answerRaw: string): Eval {
  const answer = norm(answerRaw);
  const it = item as Record<string, any>;
  const reveal: Eval['reveal'] = {};
  if (it.example) reveal.example = it.example;
  if (it.note) reveal.note = it.note;
  if (it.trap) reveal.trap = it.trap;
  if (it.use) reveal.use = it.use;
  if (it.explain) reveal.explain = it.explain;
  if (item.kind === 'noun') reveal.article = item.article;
  if (item.kind === 'verb_case' && item.reverse_structure) reveal.note = [reveal.note, 'ters yapı: şey özne, kişi Dativ'].filter(Boolean).join(' · ');

  const done = (c: Check, expected: string, userLine = answer, expectedLine = expected): Eval => ({ ...c, expected, userLine, expectedLine, reveal });
  const yes: Check = { correct: true, caseOnly: false, notes: [] };
  const no: Check = { correct: false, caseOnly: false, notes: [] };

  if (variant === 'artikel' && item.kind === 'noun') {
    return done(answer === item.article ? yes : no, `${item.article} ${item.de}`, answer ? `${answer} ${item.de}` : item.de, `${item.article} ${item.de}`);
  }
  if (variant === 'trde') {
    if (item.kind === 'noun') return done(checkNoun(answer, item.article, item.de), `${item.article} ${item.de}`);
    const de = (item as { de: string }).de;
    return done(checkGerman(answer, [de], { ignoreEndPunct: item.kind === 'phrase' }), de);
  }
  if (variant === 'detr') {
    const trs = (item as { tr: string[] }).tr;
    return done(checkTurkish(answer, trs), trs.join(' / '));
  }
  if (variant === 'case') {
    const key = labelKey(CASE_LABEL, answer);
    const exp = (item as { case: string }).case;
    return done(key === exp ? yes : no, CASE_LABEL[exp]);
  }
  if (variant === 'vpos' && item.kind === 'conj') {
    const key = labelKey(VPOS_LABEL, answer);
    return done(key === item.verb_position ? yes : no, VPOS_LABEL[item.verb_position]);
  }
  if (variant === 'cloze' && item.kind === 'verb_case' && item.cloze) {
    const exp = inner(item.cloze);
    return done(checkGerman(answer, [exp]), exp, fill(item.cloze, answer || '…'), fill(item.cloze, exp));
  }
  if (variant.startsWith('form:') && item.kind === 'word' && item.forms) {
    const exp = (item.forms as Record<string, string>)[variant.slice(5)];
    return done(checkGerman(answer, [exp]), exp);
  }
  if (variant === 'main' && item.kind === 'grammar') {
    if (item.format === 'mcq') return done(answer === item.answer ? yes : no, item.answer);
    if (item.format === 'cloze') {
      const exp = inner(item.text);
      const acc = [exp, ...(item.accept ?? [])];
      return done(checkGerman(answer, acc), exp, fill(item.text, answer || '…'), fill(item.text, exp));
    }
    return done(answer === 'known' ? yes : no, item.answer, answer === 'known' ? 'bildim' : 'bilemedim', item.answer);
  }
  throw new Error(`cannot evaluate ${item.id}#${variant}`);
}
