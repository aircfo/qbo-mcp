import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** Bearer values are hashed at rest; we only ever compare, never reveal them. */
function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  mcpState?: string;
  /** Self-reported email collected on the connect page (unverified). */
  email?: string;
  termsAcceptedAt?: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface TokenRow {
  token_hash: string;
  kind: string;
  client_id: string | null;
  connection_id: string | null;
  code_challenge: string | null;
  redirect_uri: string | null;
  metadata: string | null;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

/**
 * SQLite-backed store for the downstream OAuth surface: registered clients plus
 * the pending-auth / auth-code / access / refresh token lifecycle. Everything
 * is persisted so a server restart never forces the user back through Intuit
 * consent (the connection row and the refresh token both survive).
 */
export class OAuthStore {
  constructor(private readonly db: Database.Database) {}

  // --- Clients (Dynamic Client Registration) ---

  readonly clientsStore: OAuthRegisteredClientsStore = {
    getClient: (clientId: string): OAuthClientInformationFull | undefined => {
      const row = this.db
        .prepare("SELECT client_info FROM oauth_clients WHERE client_id = ?")
        .get(clientId) as { client_info: string } | undefined;
      return row
        ? (JSON.parse(row.client_info) as OAuthClientInformationFull)
        : undefined;
    },
    registerClient: (
      client: Omit<
        OAuthClientInformationFull,
        "client_id" | "client_id_issued_at"
      >,
    ): OAuthClientInformationFull => {
      const full: OAuthClientInformationFull = {
        ...client,
        client_id: randomUUID(),
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      this.db
        .prepare(
          "INSERT INTO oauth_clients (client_id, client_info, created_at) VALUES (?, ?, ?)",
        )
        .run(full.client_id, JSON.stringify(full), Date.now());
      return full;
    },
  };

  // --- Pending authorization (the Intuit round-trip) ---

  /** Returns the opaque `state` value to hand to Intuit. */
  createPendingAuth(input: PendingAuth): string {
    const state = newToken();
    this.db
      .prepare(
        `INSERT INTO oauth_tokens
          (token_hash, kind, client_id, code_challenge, redirect_uri, metadata, expires_at, created_at)
         VALUES (?, 'pending_auth', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hash(state),
        input.clientId,
        input.codeChallenge,
        input.redirectUri,
        JSON.stringify({
          scopes: input.scopes,
          mcpState: input.mcpState,
          email: input.email,
          termsAcceptedAt: input.termsAcceptedAt,
        }),
        Date.now() + TEN_MINUTES_MS,
        Date.now(),
      );
    return state;
  }

  consumePendingAuth(state: string): PendingAuth | null {
    const row = this.take(state, "pending_auth");
    if (!row) return null;
    const meta = row.metadata
      ? (JSON.parse(row.metadata) as {
          scopes?: string[];
          mcpState?: string;
          email?: string;
          termsAcceptedAt?: number;
        })
      : {};
    return {
      clientId: row.client_id!,
      redirectUri: row.redirect_uri!,
      codeChallenge: row.code_challenge!,
      scopes: meta.scopes ?? [],
      mcpState: meta.mcpState,
      email: meta.email,
      termsAcceptedAt: meta.termsAcceptedAt,
    };
  }

  // --- Authorization codes ---

  issueAuthCode(input: {
    clientId: string;
    connectionId: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const code = newToken();
    this.db
      .prepare(
        `INSERT INTO oauth_tokens
          (token_hash, kind, client_id, connection_id, code_challenge, redirect_uri, expires_at, created_at)
         VALUES (?, 'auth_code', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hash(code),
        input.clientId,
        input.connectionId,
        input.codeChallenge,
        input.redirectUri,
        Date.now() + TEN_MINUTES_MS,
        Date.now(),
      );
    return code;
  }

  /** For the SDK's PKCE check — the challenge bound to a still-valid code. */
  codeChallengeFor(code: string): string | null {
    const row = this.peek(code, "auth_code");
    return row?.code_challenge ?? null;
  }

  consumeAuthCode(
    code: string,
  ): { clientId: string; connectionId: string; redirectUri: string } | null {
    const row = this.take(code, "auth_code");
    if (!row) return null;
    return {
      clientId: row.client_id!,
      connectionId: row.connection_id!,
      redirectUri: row.redirect_uri!,
    };
  }

  // --- Access + refresh tokens ---

  issueTokens(input: { clientId: string; connectionId: string }): IssuedTokens {
    const accessToken = newToken();
    const refreshToken = newToken();
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, client_id, connection_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      hash(accessToken),
      "access",
      input.clientId,
      input.connectionId,
      now + ACCESS_TTL_MS,
      now,
    );
    insert.run(
      hash(refreshToken),
      "refresh",
      input.clientId,
      input.connectionId,
      now + REFRESH_TTL_MS,
      now,
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    };
  }

  verifyAccess(
    token: string,
  ): { clientId: string; connectionId: string; expiresAt: number } | null {
    const row = this.peek(token, "access");
    if (!row) return null;
    return {
      clientId: row.client_id!,
      connectionId: row.connection_id!,
      expiresAt: row.expires_at,
    };
  }

  /** Rotate: consume the presented refresh token, issue a fresh pair. */
  rotateRefresh(
    refreshToken: string,
  ): (IssuedTokens & { clientId: string; connectionId: string }) | null {
    const row = this.take(refreshToken, "refresh");
    if (!row) return null;
    const tokens = this.issueTokens({
      clientId: row.client_id!,
      connectionId: row.connection_id!,
    });
    return {
      ...tokens,
      clientId: row.client_id!,
      connectionId: row.connection_id!,
    };
  }

  revoke(token: string): void {
    this.db
      .prepare(
        "UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), hash(token));
  }

  /** Revoke every live downstream token for a connection (used on disconnect). */
  revokeConnectionTokens(connectionId: string): void {
    this.db
      .prepare(
        "UPDATE oauth_tokens SET revoked_at = ? WHERE connection_id = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), connectionId);
  }

  // --- internals ---

  /** Read a live (unexpired, unrevoked) row without consuming it. */
  private peek(raw: string, kind: string): TokenRow | null {
    const row = this.db
      .prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = ?")
      .get(hash(raw), kind) as TokenRow | undefined;
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at <= Date.now()) return null;
    return row;
  }

  /** Read-and-delete a single-use row atomically (in-process, synchronous). */
  private take(raw: string, kind: string): TokenRow | null {
    const row = this.peek(raw, kind);
    if (!row) return null;
    this.db
      .prepare("DELETE FROM oauth_tokens WHERE token_hash = ?")
      .run(row.token_hash);
    return row;
  }
}
