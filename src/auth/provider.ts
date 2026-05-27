import type { Response } from "express";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStore } from "./oauth-store.js";
import { renderConnectPage } from "./connect-page.js";

const SCOPE = "com.intuit.quickbooks.accounting";

/**
 * Bridges the MCP OAuth surface (Claude ↔ this server) to Intuit's OAuth
 * (this server ↔ QuickBooks). The `authorize` step renders the connect page
 * (which collects an email, then forwards to Intuit via /connect/start); the
 * Intuit callback (see auth/intuit-callback.ts) creates the connection and
 * issues our own authorization code. The remaining methods are the standard
 * code/refresh/verify lifecycle, backed by OAuthStore.
 */
export class QboOAuthProvider implements OAuthServerProvider {
  constructor(private readonly store: OAuthStore) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store.clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // The SDK has already validated client + redirect_uri + PKCE here, so we
    // render the email-collection page; /connect/start re-validates on submit.
    res.type("html").send(
      renderConnectPage({
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        mcpState: params.state,
      }),
    );
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const challenge = this.store.codeChallengeFor(authorizationCode);
    if (!challenge)
      throw new InvalidGrantError("Unknown or expired authorization code");
    return challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const consumed = this.store.consumeAuthCode(authorizationCode);
    if (!consumed || consumed.clientId !== client.client_id) {
      throw new InvalidGrantError("Unknown or expired authorization code");
    }
    const tokens = this.store.issueTokens({
      clientId: client.client_id,
      connectionId: consumed.connectionId,
    });
    return {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: SCOPE,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const rotated = this.store.rotateRefresh(refreshToken);
    if (!rotated || rotated.clientId !== client.client_id) {
      throw new InvalidGrantError("Unknown or expired refresh token");
    }
    return {
      access_token: rotated.accessToken,
      token_type: "Bearer",
      expires_in: rotated.expiresIn,
      refresh_token: rotated.refreshToken,
      scope: SCOPE,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verified = this.store.verifyAccess(token);
    if (!verified)
      throw new InvalidTokenError("Unknown or expired access token");
    return {
      token,
      clientId: verified.clientId,
      scopes: [SCOPE],
      expiresAt: Math.floor(verified.expiresAt / 1000),
      extra: { connectionId: verified.connectionId },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.store.revoke(request.token);
  }
}
