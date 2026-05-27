import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * Open (and initialise) the SQLite database. The schema is created idempotently
 * on open — `CREATE TABLE IF NOT EXISTS` is our migration story for v1.
 *
 * Pass ":memory:" for tests. For a file path, the parent directory is created
 * if missing so a fresh Railway volume mount works on first boot.
 */
export function openDatabase(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  // WAL gives safer concurrent reads/writes; it's a no-op for in-memory dbs.
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id                 TEXT PRIMARY KEY,
      realm_id           TEXT NOT NULL,
      company_name       TEXT,
      email              TEXT,
      terms_accepted_at  INTEGER,
      access_token_enc   TEXT NOT NULL,
      access_expires_at  INTEGER NOT NULL,
      refresh_token_enc  TEXT NOT NULL,
      refresh_updated_at INTEGER NOT NULL,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    );

    -- Dynamically-registered MCP clients (Claude). client_info is the full
    -- OAuthClientInformationFull JSON the SDK round-trips.
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id   TEXT PRIMARY KEY,
      client_info TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    -- Downstream (Claude ↔ this server) OAuth artifacts. Token values are
    -- never stored raw — token_hash holds sha256(rawValue). One table, keyed by
    -- 'kind': the short-lived Intuit round-trip state, single-use auth codes,
    -- access tokens, and rotating refresh tokens.
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash     TEXT PRIMARY KEY,
      kind           TEXT NOT NULL,
      client_id      TEXT,
      connection_id  TEXT,
      code_challenge TEXT,
      redirect_uri   TEXT,
      metadata       TEXT,
      expires_at     INTEGER NOT NULL,
      revoked_at     INTEGER,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_kind ON oauth_tokens (kind);
  `);

  // Migrations for databases created before a column existed (CREATE TABLE IF
  // NOT EXISTS won't add columns to an existing table). Safe + idempotent.
  ensureColumn(db, "connections", "email", "TEXT");
  ensureColumn(db, "connections", "terms_accepted_at", "INTEGER");

  return db;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
