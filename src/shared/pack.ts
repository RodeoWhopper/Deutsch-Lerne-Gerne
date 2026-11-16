// deutsch-pack/1 validator (single source of truth; JSON Schema is generated from it).
import { z } from 'zod';

// Control chars (incl. newline/tab), bidi overrides, zero-width, BOM, line/para separators.
const BAD = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2069\\uFEFF]', 'u');

const text = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !BAD.test(s), { message: 'kontrol karakteri içeriyor' });

const idRe = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const itemId = z.string().regex(idRe);
const trList = z.array(text(80)).min(1).max(8);
const example = z.strictObject({ de: text(200), tr: text(200) });
const common = {
  id: itemId,
  note: text(400).optional(),
  tags: z.array(text(24)).max(8).optional(),
};

const startsUpper = (s: string) => {
  const c = s.charAt(0);
  return c !== c.toLowerCase() && c === c.toUpperCase();
};

const noun = z
  .strictObject({
    ...common,
    kind: z.literal('noun'),
    de: text(60),
    article: z.enum(['der', 'die', 'das']),
    plural: text(60).optional(),
    plural_only: z.boolean().optional(),
    tr: trList,
    example: example.optional(),
  })
  .refine((n) => startsUpper(n.de) && !/^(der|die|das)\s/i.test(n.de), {
    message: 'noun.de büyük harfle başlamalı ve artikel içermemeli',
    path: ['de'],
  })
  .refine((n) => !n.plural_only || n.article === 'die', {
    message: 'plural_only için article "die" olmalı',
    path: ['article'],
  });

const forms = z.strictObject({
  ich: text(40).optional(),
  du: text(40).optional(),
  er: text(40).optional(),
  wir: text(40).optional(),
  ihr: text(40).optional(),
  sie: text(40).optional(),
});

const word = z
  .strictObject({
    ...common,
    kind: z.literal('word'),
    pos: z.enum(['verb', 'adj', 'adv', 'other']),
    de: text(60),
    tr: trList,
    forms: forms.optional(),
    example: example.optional(),
  })
  .refine((w) => !w.forms || w.pos === 'verb', { message: 'forms yalnızca fiilde', path: ['forms'] });

const clozeOnce = (s: string) => {
  const m = s.match(/\{\{[^{}]+\}\}/g);
  const stripped = s.replace(/\{\{[^{}]+\}\}/g, '');
  return !!m && m.length === 1 && !/[{}]/.test(stripped);
};

const verbCase = z
  .strictObject({
    ...common,
    kind: z.literal('verb_case'),
    de: text(60),
    tr: trList,
    case: z.enum(['akk', 'dat', 'both']),
    reverse_structure: z.boolean().optional(),
    cloze: text(200).optional(),
    trap: text(300).optional(),
    example: example.optional(),
  })
  .refine((v) => v.cloze === undefined || clozeOnce(v.cloze), {
    message: 'cloze tam bir {{...}} içermeli',
    path: ['cloze'],
  });

const prep = z.strictObject({
  ...common,
  kind: z.literal('prep'),
  de: text(40),
  tr: trList,
  case: z.enum(['akk', 'dat', 'gen', 'wechsel']),
  use: text(200).optional(),
  example: example,
});

const conj = z.strictObject({
  ...common,
  kind: z.literal('conj'),
  de: text(40),
  tr: trList,
  verb_position: z.enum(['end', 'second', 'none']),
  example: example,
});

const gMcq = z
  .strictObject({
    ...common,
    kind: z.literal('grammar'),
    format: z.literal('mcq'),
    prompt: text(200),
    choices: z.array(text(60)).min(2).max(6),
    answer: text(60),
    explain: text(300).optional(),
  })
  .refine((g) => g.choices.includes(g.answer), { message: 'answer choices içinde olmalı', path: ['answer'] })
  .refine((g) => new Set(g.choices).size === g.choices.length, { message: 'choices tekrarsız olmalı', path: ['choices'] });

const gCloze = z
  .strictObject({
    ...common,
    kind: z.literal('grammar'),
    format: z.literal('cloze'),
    text: text(200),
    accept: z.array(text(60)).max(8).optional(),
    explain: text(300).optional(),
  })
  .refine((g) => clozeOnce(g.text), { message: 'text tam bir {{...}} içermeli', path: ['text'] });

const gQa = z.strictObject({
  ...common,
  kind: z.literal('grammar'),
  format: z.literal('qa'),
  prompt: text(200),
  answer: text(300),
  explain: text(300).optional(),
});

const phrase = z.strictObject({
  ...common,
  kind: z.literal('phrase'),
  de: text(200),
  tr: trList,
});

export const itemSchema = z.union([noun, word, verbCase, prep, conj, gMcq, gCloze, gQa, phrase]);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, { message: 'geçersiz tarih' });

export const packSchema = z
  .strictObject({
    standard: z.literal('deutsch-pack/1'),
    pack: z.strictObject({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
      title: text(80),
      version: z.number().int().min(1).max(9999),
      level: z.enum(['A1', 'A2', 'B1', 'B2']),
      taught_on: isoDate,
      unit: z.string().regex(/^[a-z0-9-]{2,32}$/),
    }),
    items: z.array(itemSchema).max(2000),
    retire: z.array(itemId).max(2000).optional(),
  })
  .refine((p) => new Set(p.items.map((i) => i.id)).size === p.items.length, {
    message: 'item id değerleri pakette tekil olmalı',
    path: ['items'],
  });

export type Item = z.infer<typeof itemSchema>;
export type Pack = z.infer<typeof packSchema>;
export const MAX_PACK_BYTES = 1_000_000;

function deepNFC(v: unknown): unknown {
  if (typeof v === 'string') return v.normalize('NFC');
  if (Array.isArray(v)) return v.map(deepNFC);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k.normalize('NFC')] = deepNFC(val);
    return o;
  }
  return v;
}

export type ParseResult = { ok: true; pack: Pack; retire: string[] } | { ok: false; errors: string[] };

/** Parse + validate pack text. Never throws. */
export function parsePack(raw: string): ParseResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_PACK_BYTES) return { ok: false, errors: ['paket 1 MB sınırını aşıyor'] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['geçerli JSON değil'] };
  }
  const r = packSchema.safeParse(deepNFC(json));
  if (!r.success) {
    const errors = r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`);
    return { ok: false, errors };
  }
  return { ok: true, pack: r.data, retire: r.data.retire ?? [] };
}
