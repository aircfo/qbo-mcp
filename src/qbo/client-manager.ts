import QuickBooks from "node-quickbooks";
import { env } from "../config/env.js";
import type { ConnectionStore } from "../store/connection-store.js";
import type { IntuitOAuth } from "./intuit-oauth.js";

/** Refresh slightly ahead of expiry so an in-flight call never races the clock. */
const EXPIRY_BUFFER_MS = 60_000;

export class ConnectionNotFoundError extends Error {
  readonly code = "connection_not_found" as const;
  constructor(connectionId: string) {
    super(`No QuickBooks connection found for id ${connectionId}`);
  }
}

/** Thrown when the Intuit refresh token is dead — the user must reconnect QBO. */
export class ReauthRequiredError extends Error {
  readonly code = "reauth_required" as const;
  constructor(cause: unknown) {
    super("QuickBooks connection expired — please reconnect QuickBooks.");
    this.cause = cause;
  }
}

/**
 * Builds a per-connection QuickBooks client, transparently refreshing the
 * Intuit access token on demand and persisting any rotated refresh token.
 * Concurrent calls for the same connection share one in-flight refresh.
 */
export class QboClientManager {
  private readonly refreshInFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly connections: ConnectionStore,
    private readonly intuit: IntuitOAuth,
  ) {}

  async getClient(
    connectionId: string,
  ): Promise<{ qb: QuickBooks; realmId: string }> {
    const accessToken = await this.getValidAccessToken(connectionId);
    const conn = this.connections.get(connectionId);
    if (!conn) throw new ConnectionNotFoundError(connectionId);
    const qb = new QuickBooks(
      env.INTUIT_CLIENT_ID,
      env.INTUIT_CLIENT_SECRET,
      accessToken,
      false, // no token secret for OAuth 2.0
      conn.realmId,
      env.INTUIT_ENVIRONMENT === "sandbox",
      false, // debug
      null, // minor version
      "2.0",
      conn.refreshToken,
    );
    return { qb, realmId: conn.realmId };
  }

  private async getValidAccessToken(connectionId: string): Promise<string> {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new ConnectionNotFoundError(connectionId);

    if (conn.accessExpiresAt - Date.now() > EXPIRY_BUFFER_MS) {
      return conn.accessToken;
    }

    let inFlight = this.refreshInFlight.get(connectionId);
    if (!inFlight) {
      inFlight = this.doRefresh(connectionId, conn.refreshToken).finally(() => {
        this.refreshInFlight.delete(connectionId);
      });
      this.refreshInFlight.set(connectionId, inFlight);
    }
    return inFlight;
  }

  private async doRefresh(
    connectionId: string,
    refreshToken: string,
  ): Promise<string> {
    try {
      const tokens = await this.intuit.refresh(refreshToken);
      this.connections.updateTokens(connectionId, {
        accessToken: tokens.accessToken,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshToken: tokens.refreshToken,
      });
      return tokens.accessToken;
    } catch (err) {
      throw new ReauthRequiredError(err);
    }
  }
}
