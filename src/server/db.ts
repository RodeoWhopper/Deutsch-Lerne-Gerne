import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  creds_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS totp (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  secret TEXT NOT NULL,
  last_step INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua TEXT NOT NULL,
  ip_trunc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_fail (
  scope TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  last_fail INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  ip_trunc TEXT NOT NULL,
  ua TEXT NOT NULL,
  event TEXT NOT NULL,
  ok INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS packs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  version INTEGER NOT NULL,
  level TEXT NOT NULL,
  taught_on TEXT NOT NULL,
  unit TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  kind TEXT NOT NULL,
  json TEXT NOT NULL,
  sig TEXT NOT NULL,
  ord INTEGER NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_pack ON items(pack_id);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  track TEXT NOT NULL,
  variant TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_item ON cards(item_id);
CREATE TABLE IF NOT EXISTS card_state (
  card_id TEXT PRIMARY KEY REFERENCES cards(id),
  ease REAL NOT NULL,
  interval_days INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  due INTEGER NOT NULL,
  stage TEXT NOT NULL,
  step INTEGER NOT NULL,
  streak INTEGER NOT NULL,
  last_review INTEGER,
  introduced_day INTEGER
);
CREATE INDEX IF NOT EXISTS state_due ON card_state(stage, due);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  grade TEXT NOT NULL,
  correct INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  mode TEXT NOT NULL,
  track TEXT NOT NULL,
  qk TEXT NOT NULL,
  hint INTEGER NOT NULL,
  was_due INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_at ON reviews(at);
CREATE INDEX IF NOT EXISTS reviews_card ON reviews(card_id, at);
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  pack_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  added INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  unchanged INTEGER NOT NULL,
  retired INTEGER NOT NULL,
  reset INTEGER NOT NULL,
  undo_json TEXT NOT NULL,
  undone_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export type DB = DatabaseSync;
let _db: DB | null = null;

export function openDb(path?: string): DB {
  const file = path ?? join(config.dataDir, 'app.db');
  if (file !== ':memory:') {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  if (file !== ':memory:') {
    try { chmodSync(file, 0o600); } catch { /* volume may not support chmod */ }
  }
  const salt = db.prepare("SELECT value FROM meta WHERE key='ip_salt'").get() as { value: string } | undefined;
  if (!salt) db.prepare("INSERT INTO meta(key,value) VALUES('ip_salt', ?)").run(randomBytes(16).toString('hex'));
  return db;
}

export function getDb(): DB {
  if (!_db) _db = openDb();
  return _db;
}
export function setDb(db: DB) { _db = db; }

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
