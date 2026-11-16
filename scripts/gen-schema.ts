// Generates schema/deutsch-pack.schema.json (JSON Schema 2020-12) from the zod source of truth.
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { packSchema } from '../src/shared/pack.ts';

const s = z.toJSONSchema(packSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
s.$id = 'https://deutsch-terminal.invalid/schema/deutsch-pack-1';
s.title = 'deutsch-pack/1';
s.description = 'Strict content pack. Cross-field rules (single {{cloze}}, answer in choices, unique ids, noun capitalisation) are enforced by the app validator in addition to this schema.';
writeFileSync('schema/deutsch-pack.schema.json', JSON.stringify(s, null, 2) + '\n');
console.log('schema/deutsch-pack.schema.json yazıldı');
