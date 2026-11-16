import { z } from 'zod';
import { getDb } from './db.ts';

export const settingsSchema = z.strictObject({
  theme: z.enum(['amber', 'green', 'dos']),
  crt: z.boolean(),
  daily_new: z.number().int().min(0).max(50),
  sprint_minutes: z.union([z.literal(10), z.literal(15), z.literal(20)]),
  sprint_new: z.boolean(),
  vibrate: z.boolean(),
  wake_lock: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULTS: Settings = { theme: 'amber', crt: false, daily_new: 10, sprint_minutes: 15, sprint_new: false, vibrate: false, wake_lock: true };

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
  }
  const p = settingsSchema.safeParse(out);
  return p.success ? p.data : DEFAULTS;
}

export function putSettings(s: Settings) {
  const db = getDb();
  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(s)) st.run(k, JSON.stringify(v));
}
