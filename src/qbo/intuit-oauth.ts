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
 * Thin wrapper over `intuit-oauth` for the upstream (server ↔ Intuit) OAuth.
 * Owns building the consent URL, exchanging the auth code, and refreshing.
 */
export class IntuitOAuth {
  private readonly oauth: OAuthClient;

  constructor() {
    this.oauth = new OAuthClient({
      clientId: env.INTUIT_CLIENT_ID,
      clientSecret: env.INTUIT_CLIENT_SECRET,
      environment: env.INTUIT_ENVIRONMENT,
      redirectUri: env.INTUIT_REDIRECT_URI,
    });
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
      refreshToken: token.refresh_token,
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
}
