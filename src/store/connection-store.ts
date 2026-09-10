import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TokenCipher } from "./crypto.js";

/**
 * A user's QuickBooks connection, with tokens in PLAINTEXT. Callers work in
 * plaintext; the store encrypts/decrypts the token fields at the DB boundary,
 * so the raw tokens never touch disk unencrypted.
 */
export interface Connection {
  id: string;
  realmId: string;
  companyName: string | null;
  /** The address that authorized this connection. */
  email: string | null;
  /** True when `email` is a Google-verified identity, not a typed-in string. */
  emailVerified: boolean;
  /** Whether write tools are enabled for this connection. Off by default. */
  writesEnabled: boolean;
  termsAcceptedAt: number | null;
  accessToken: string;
  /** Epoch ms at which the access token expires. */
  accessExpiresAt: number;
  refreshToken: string;
  refreshUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewConnection {
  realmId: string;
  companyName?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  termsAcceptedAt?: number | null;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
}

/** An administrative listing row: identity and state, never credentials. */
export interface ConnectionSummaryRow {
  id: string;
  realm_id: string;
  company_name: string | null;
  email: string | null;
  email_verified: number;
  writes_enabled: number;
  created_at: number;
  refresh_updated_at: number;
}

/** The row shape as stored (token columns hold ciphertext). */
interface ConnectionRow {
  id: string;
  realm_id: string;
  company_name: string | null;
  email: string | null;
  email_verified: number;
  writes_enabled: number;
  terms_accepted_at: number | null;
  access_token_enc: string;
  access_expires_at: number;
  refresh_token_enc: string;
  refresh_updated_at: number;
  created_at: number;
  updated_at: number;
}

/**
 * Durable per-user store of Intuit connections. This is the only long-lived
 * state the server keeps — one row per connected QuickBooks company.
 */
export class ConnectionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: TokenCipher,
  ) {}

  /** Create a new connection, returning its generated id. */
  create(input: NewConnection): string {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO connections
          (id, realm_id, company_name, email, email_verified, terms_accepted_at,
           access_token_enc, access_expires_at, refresh_token_enc,
           refresh_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.realmId,
        input.companyName ?? null,
        input.email ?? null,
        input.emailVerified ? 1 : 0,
        input.termsAcceptedAt ?? null,
        this.cipher.encrypt(input.accessToken),
        input.accessExpiresAt,
        this.cipher.encrypt(input.refreshToken),
        now,
        now,
        now,
      );
    return id;
  }

  get(id: string): Connection | null {
    const row = this.db
      .prepare(`SELECT * FROM connections WHERE id = ?`)
      .get(id) as ConnectionRow | undefined;
    return row ? this.toConnection(row) : null;
  }

  /**
   * The most recent connection for one person and one company, used to fold a
   * re-authorization into the row it replaces instead of adding another.
   *
   * Ordered newest-first because the table already holds several rows per pair
   * — every re-authorization made one before this existed. `rowid` breaks a
   * tie on `created_at`, which is only millisecond-resolution: without it two
   * authorizations in the same millisecond leave the choice to SQLite, and it
   * does not pick the later one.
   */
  findByRealmAndEmail(realmId: string, email: string): Connection | null {
    const row = this.db
      .prepare(
        `SELECT * FROM connections
         WHERE realm_id = ? AND email = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(realmId, email) as ConnectionRow | undefined;
    return row ? this.toConnection(row) : null;
  }

  /**
   * Cache the company's display name. Not secret and not authoritative — it is
   * what an admin listing shows instead of a bare realm id.
   */
  setCompanyName(id: string, companyName: string): void {
    this.db
      .prepare(
        `UPDATE connections SET company_name = ?, updated_at = ? WHERE id = ?`,
      )
      .run(companyName, Date.now(), id);
  }

  /**
   * Persist a freshly refreshed token pair. Always pass whatever refresh token
   * Intuit last returned — it rotates periodically and the latest value must
   * be saved or refresh eventually breaks.
   */
  updateTokens(
    id: string,
    tokens: {
      accessToken: string;
      accessExpiresAt: number;
      refreshToken: string;
    },
  ): void {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE connections SET
           access_token_enc = ?, access_expires_at = ?,
           refresh_token_enc = ?, refresh_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        this.cipher.encrypt(tokens.accessToken),
        tokens.accessExpiresAt,
        this.cipher.encrypt(tokens.refreshToken),
        now,
        now,
        id,
      );
    if (result.changes === 0) {
      throw new Error(`updateTokens: no connection with id ${id}`);
    }
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM connections WHERE id = ?`).run(id);
  }

  /**
   * Promote a row whose `email` predates the identity gate, once the same
   * address has proved itself through Google.
   */
  setEmailVerified(id: string, verified: boolean): void {
    this.db
      .prepare(
        `UPDATE connections SET email_verified = ?, updated_at = ? WHERE id = ?`,
      )
      .run(verified ? 1 : 0, Date.now(), id);
  }

  /** Turn write tools on or off for one connection. Administrative. */
  setWritesEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE connections SET writes_enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, Date.now(), id);
  }

  /**
   * Every connection, without its credentials. Deliberately not built on
   * `toConnection`: an administrative listing has no use for tokens, and
   * decrypting dozens of them to throw them away is both wasteful and a way
   * for plaintext credentials to end up somewhere they were not wanted.
   */
  listSummaries(): ConnectionSummaryRow[] {
    return this.db
      .prepare(
        `SELECT id, realm_id, company_name, email, email_verified,
                writes_enabled, created_at, refresh_updated_at
         FROM connections ORDER BY created_at`,
      )
      .all() as ConnectionSummaryRow[];
  }

  private toConnection(row: ConnectionRow): Connection {
    return {
      id: row.id,
      realmId: row.realm_id,
      companyName: row.company_name,
      email: row.email,
      emailVerified: row.email_verified === 1,
      writesEnabled: row.writes_enabled === 1,
      termsAcceptedAt: row.terms_accepted_at,
      accessToken: this.cipher.decrypt(row.access_token_enc),
      accessExpiresAt: row.access_expires_at,
      refreshToken: this.cipher.decrypt(row.refresh_token_enc),
      refreshUpdatedAt: row.refresh_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
