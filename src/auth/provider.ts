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
import { log } from "../log.js";
import { isAllowedUser } from "./access.js";
import { googleAuthUrl } from "./google-idp.js";

/**
 * The single scope this server grants. Exported so the OAuth metadata
 * (`scopesSupported` in index.ts) advertises exactly what the provider issues —
 * advertising nothing while granting this string is the scope incoherence that
 * can surface as "Unavailable scope was requested" on connect.
 */
export const SCOPE = "com.intuit.quickbooks.accounting";

/**
 * Bridges the MCP OAuth surface (Claude ↔ this server) to the connect flow.
 * `authorize` parks the request and sends the caller to Google, which
 * establishes identity (auth/google-callback.ts); Intuit then grants access to
 * a company (auth/intuit-callback.ts); and the confirmation step
 * (auth/connect-confirm.ts) is where an authorization code is finally issued.
 * The remaining methods are the standard code/refresh/verify lifecycle, backed
 * by OAuthStore — with `verifyAccessToken` additionally re-checking identity on
 * every request.
 */
export class QboOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: OAuthStore,
    /** Read to re-check identity on every request; see verifyAccessToken. */
    private readonly connections: {
      get(id: string): {
        email: string | null;
        emailVerified: boolean;
      } | null;
    },
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store.clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // The SDK has already validated client, redirect_uri and PKCE. Identity
    // comes next: park the request under an opaque state and send the caller
    // to Google. The old flow asked for an email on a form here and believed
    // the answer.
    const state = this.store.createPendingAuth({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: [],
      mcpState: params.state,
    });
    res.redirect(googleAuthUrl(state));
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
      // Logged because a rejection here means a connect attempt died at the
      // last step, which the connect funnel's drop-off cannot otherwise explain.
      log.warn(
        { clientId: client.client_id, known: Boolean(consumed) },
        "auth_code_rejected",
      );
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
      // Refresh is rotate-and-destroy with no reuse window, so two sessions
      // sharing one stored credential can race and the loser lands here. That
      // would force a manual reconnect, so it is logged to be counted: if these
      // lines appear in production, rotation needs a grace window.
      log.warn(
        { clientId: client.client_id, known: Boolean(rotated) },
        "refresh_token_rejected",
      );
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

    // The allowlist is re-checked on every request, not just at sign-in, so
    // removing someone cuts their access off immediately instead of whenever
    // their token happens to expire. A connection made before the identity
    // gate has no verified address and is refused here — that is the one-time
    // re-authorization, and it is why it cannot be skipped.
    const connection = this.connections.get(verified.connectionId);
    const email = connection?.email ?? null;
    if (
      !connection ||
      !email ||
      !isAllowedUser(email, connection.emailVerified)
    ) {
      log.warn(
        {
          connectionId: verified.connectionId,
          email,
          emailVerified: connection?.emailVerified ?? false,
          reason: !connection
            ? "connection_gone"
            : !connection.emailVerified
              ? "identity_not_verified"
              : "not_allowlisted",
        },
        "access_refused",
      );
      throw new InvalidTokenError(
        "This connection needs to be re-authorized: sign in with your airCFO Google account.",
      );
    }

    return {
      token,
      clientId: verified.clientId,
      scopes: [SCOPE],
      expiresAt: Math.floor(verified.expiresAt / 1000),
      extra: { connectionId: verified.connectionId, email },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.store.revoke(request.token);
  }
}
