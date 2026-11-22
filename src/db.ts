import { DatabaseSync } from "node:sqlite"

const SCHEMA = [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA synchronous = NORMAL;",
  "CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, refs INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, blob_hash TEXT, size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER);",
  "CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes (parent_id, deleted, kind);",
  "CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes (parent_id, name, deleted);",
  "CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, size INTEGER NOT NULL, hash TEXT, path TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, replace_node TEXT, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, blob_hash TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_versions_node ON versions (node_id, created_at DESC);",
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, last_login INTEGER);",
  "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, node_id TEXT NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL, downloads INTEGER NOT NULL DEFAULT 0, ttl_hours INTEGER NOT NULL DEFAULT 0);",
  "CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, to_device TEXT NOT NULL, from_device TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_transfers_device ON transfers (to_device, status);",
].join("\n")

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  // Full-text index over file names. Trigram tokenisation is what makes Chinese
  // substring search work; queries shorter than 3 characters fall back to LIKE.
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(name, content='nodes', content_rowid='rowid', tokenize='trigram')")
    db.exec("CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes BEGIN INSERT INTO nodes_fts(rowid, name) VALUES (new.rowid, new.name); END")
    db.exec("CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN INSERT INTO nodes_fts(nodes_fts, rowid, name) VALUES ('delete', old.rowid, old.name); END")
    db.exec("CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE OF name ON nodes BEGIN INSERT INTO nodes_fts(nodes_fts, rowid, name) VALUES ('delete', old.rowid, old.name); INSERT INTO nodes_fts(rowid, name) VALUES (new.rowid, new.name); END")
    const indexed = (db.prepare("SELECT COUNT(*) c FROM nodes_fts").get() as any).c as number
    if (indexed === 0) db.exec("INSERT INTO nodes_fts(nodes_fts) VALUES ('rebuild')")
  } catch (err: any) {
    console.error("[fts] unavailable, search falls back to LIKE:", err?.message)
  }

  const cols = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>
  if (!cols.some((col) => col.name === "expires_at")) {
    db.exec("ALTER TABLE nodes ADD COLUMN expires_at INTEGER")
  }
  if (!cols.some((col) => col.name === "deleted_at")) {
    db.exec("ALTER TABLE nodes ADD COLUMN deleted_at INTEGER")
  }
  const shareCols = db.prepare("PRAGMA table_info(shares)").all() as Array<{ name: string }>
  if (!shareCols.some((col) => col.name === "ttl_hours")) {
    db.exec("ALTER TABLE shares ADD COLUMN ttl_hours INTEGER NOT NULL DEFAULT 0")
  }
  return db
}
