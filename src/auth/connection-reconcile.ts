import type { Connection, NewConnection } from "../store/connection-store.js";

/**
 * The store and revoke operations this module needs, narrowed to what it calls
 * so a test can supply plain objects.
 */
export interface ReconcileDeps {
  connections: {
    findByRealmAndEmail(realmId: string, email: string): Connection | null;
    create(input: NewConnection): string;
    updateTokens(
      id: string,
      tokens: {
        accessToken: string;
        accessExpiresAt: number;
        refreshToken: string;
      },
    ): void;
    setEmailVerified(id: string, verified: boolean): void;
  };
  /** Best-effort upstream revoke of a token we are about to stop storing. */
  revokeIntuitToken(token: string): Promise<void>;
  onRevokeFailed(err: unknown, connectionId: string): void;
}

export interface ReconcileInput {
  realmId: string;
  /** The address that authorized this connection. */
  email: string | null;
  /** True when `email` came from a verified Google sign-in. */
  emailVerified: boolean;
  termsAcceptedAt: number | null;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
}

export interface ReconcileResult {
  connectionId: string;
  /** True when an existing connection was refreshed rather than a new one made. */
  reused: boolean;
}

/**
 * Turn a completed Intuit authorization into exactly one stored connection.
 *
 * Before this, every authorization inserted a row, so re-authorizing the same
 * company left the previous row behind holding Intuit credentials that stay
 * live at Intuit for 100 days — and the hourly session defect made people
 * re-authorize constantly, which is why one person has thirteen rows for one
 * company. A repeat authorization now lands on the row it replaces.
 *
 * The row is **reused, never replaced**, because one person legitimately has
 * several MCP clients on the same company (claude.ai plus a Claude Code client
 * per folder). Those clients hold separate downstream tokens that all resolve
 * to this one connection id, so reusing the row keeps every one of them
 * working, while deleting and re-creating would break each client except the
 * one that just authorized.
 *
 * Keying on a self-reported email is sound here even though it is unverified:
 * reaching this code at all means Intuit consent for that exact company
 * succeeded, so a caller who claims someone else's address gains nothing they
 * did not already prove they have.
 */
export async function reconcileConnection(
  deps: ReconcileDeps,
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const existing = input.email
    ? deps.connections.findByRealmAndEmail(input.realmId, input.email)
    : null;

  if (!existing) {
    return {
      connectionId: deps.connections.create({
        realmId: input.realmId,
        email: input.email,
        emailVerified: input.emailVerified,
        termsAcceptedAt: input.termsAcceptedAt,
        accessToken: input.accessToken,
        accessExpiresAt: input.accessExpiresAt,
        refreshToken: input.refreshToken,
      }),
      reused: false,
    };
  }

  // Retire the credential we are about to drop — but only when Intuit actually
  // issued a different one. Revoking a refresh token also invalidates its
  // access tokens, so revoking a value Intuit just handed back would destroy
  // the connection this call is establishing.
  if (existing.refreshToken !== input.refreshToken) {
    try {
      await deps.revokeIntuitToken(existing.refreshToken);
    } catch (err) {
      deps.onRevokeFailed(err, existing.id);
    }
  }

  deps.connections.updateTokens(existing.id, {
    accessToken: input.accessToken,
    accessExpiresAt: input.accessExpiresAt,
    refreshToken: input.refreshToken,
  });

  // Promote a row that predates the identity gate. Its address was typed on
  // the old connect page; the same address has now proved itself through
  // Google, which is exactly what the one-time re-authorization is for.
  if (input.emailVerified && !existing.emailVerified) {
    deps.connections.setEmailVerified(existing.id, true);
  }

  return { connectionId: existing.id, reused: true };
}
