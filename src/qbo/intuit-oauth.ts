import OAuthClient from "intuit-oauth";
import { env } from "../config/env.js";

/** Normalised token set, with the access-token expiry as an absolute epoch-ms. */
export interface IntuitTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  /** Present only on the initial code exchange — identifies the QBO company. */
  realmId?: string;
}

/**
 * The surface we use from `intuit-oauth`, named so a test can supply a double.
 * The library's client also carries mutable token state of its own, which this
 * wrapper deliberately never relies on — see `revoke`.
 */
export interface IntuitOAuthClient {
  authorizeUri(params: { scope: string[]; state: string }): string;
  createToken(callbackUrl: string): Promise<{ token: IntuitTokenResponse }>;
  refreshUsingToken(
    refreshToken: string,
  ): Promise<{ token: IntuitTokenResponse }>;
  revoke(params: {
    refresh_token?: string;
    access_token?: string;
  }): Promise<unknown>;
}

interface IntuitTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  realmId?: string;
}

function defaultClient(): IntuitOAuthClient {
  return new OAuthClient({
    clientId: env.INTUIT_CLIENT_ID,
    clientSecret: env.INTUIT_CLIENT_SECRET,
    environment: env.INTUIT_ENVIRONMENT,
    redirectUri: env.INTUIT_REDIRECT_URI,
  }) as unknown as IntuitOAuthClient;
}

/**
 * Thin wrapper over `intuit-oauth` for the upstream (server ↔ Intuit) OAuth.
 * Owns building the consent URL, exchanging the auth code, refreshing, and
 * revoking.
 */
export class IntuitOAuth {
  private readonly oauth: IntuitOAuthClient;

  constructor(oauth: IntuitOAuthClient = defaultClient()) {
    this.oauth = oauth;
  }

  authorizeUri(state: string): string {
    return this.oauth.authorizeUri({
      scope: [OAuthClient.scopes.Accounting],
      state,
    });
  }

  async exchangeCode(callbackUrl: string): Promise<IntuitTokens> {
    const { token } = await this.oauth.createToken(callbackUrl);
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      accessExpiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      realmId: token.realmId,
    };
  }

  async refresh(refreshToken: string): Promise<IntuitTokens> {
    const { token } = await this.oauth.refreshUsingToken(refreshToken);
    return {
      accessToken: token.access_token,
      // Intuit rotates the refresh token periodically; keep whatever it last
      // returned, falling back to the one we sent if unchanged.
      refreshToken: token.refresh_token ?? refreshToken,
      accessExpiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    };
  }

  /**
   * Revoke a refresh token with Intuit, ending that authorization.
   *
   * The parameter name matters and is the reason this method has a test.
   * `OAuthClient.revoke` reads `params.access_token || params.refresh_token ||
   * <whatever token the client instance currently holds>`. Passing any other
   * key — `{ token }`, say — is silently ignored, and the fallback then revokes
   * the client's *own* current token. On this server that client is a
   * long-lived singleton whose state was last set by `createToken`, so the
   * fallback revoked the access token we had just minted: connections came back
   * from a successful authorization already dead, with Intuit answering 401
   * AuthenticationFailed seconds later.
   */
  async revoke(refreshToken: string): Promise<void> {
    await this.oauth.revoke({ refresh_token: refreshToken });
  }
}
