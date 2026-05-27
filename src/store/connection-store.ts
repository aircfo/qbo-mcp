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
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
}

/** The row shape as stored (token columns hold ciphertext). */
interface ConnectionRow {
  id: string;
  realm_id: string;
  company_name: string | null;
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
          (id, realm_id, company_name, access_token_enc, access_expires_at,
           refresh_token_enc, refresh_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.realmId,
        input.companyName ?? null,
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

  private toConnection(row: ConnectionRow): Connection {
    return {
      id: row.id,
      realmId: row.realm_id,
      companyName: row.company_name,
      accessToken: this.cipher.decrypt(row.access_token_enc),
      accessExpiresAt: row.access_expires_at,
      refreshToken: this.cipher.decrypt(row.refresh_token_enc),
      refreshUpdatedAt: row.refresh_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
