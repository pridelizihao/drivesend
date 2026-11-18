import { DatabaseSync } from "node:sqlite"

const SCHEMA = [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA synchronous = NORMAL;",
  "CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, refs INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, blob_hash TEXT, size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER);",
  "CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes (parent_id, deleted, kind);",
  "CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes (parent_id, name, deleted);",
  "CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, node_id TEXT NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL, downloads INTEGER NOT NULL DEFAULT 0);",
  "CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, to_device TEXT NOT NULL, from_device TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_transfers_device ON transfers (to_device, status);",
].join("\n")

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  const cols = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>
  if (!cols.some((col) => col.name === "expires_at")) {
    db.exec("ALTER TABLE nodes ADD COLUMN expires_at INTEGER")
  }
  return db
}
