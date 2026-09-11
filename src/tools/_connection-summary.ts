import type { Connection } from "../store/connection-store.js";

/**
 * What this server knows about a connection without asking Intuit anything:
 * which company it is bound to, who authorized it, whether that identity was
 * proven, and whether writes are enabled.
 */
export interface ConnectionSummary {
  realmId: string;
  environment: "sandbox" | "production";
  companyName: string | null;
  connectedBy: {
    email: string | null;
    /**
     * True only when Google returned this address on a verified `id_token`.
     * A connection made before the identity gate has it false and is refused
     * by `verifyAccessToken` until the person authorizes once more.
     */
    verified: boolean;
  };
  connectedAt: string;
  lastRefreshAt: string;
  /** Whether write tools are enabled for this connection. Off by default. */
  writesEnabled: boolean;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Describe a connection for the caller.
 *
 * Every field is read from the connection. `verified` and `writesEnabled` were
 * once hardcoded `false` here, which meant both tools reported a connection as
 * unverified and writes-disabled no matter what the row actually said — a tool
 * answering confidently and wrongly about the safety state of a client's
 * books. Pure and separate from the tool registration so the mapping can be
 * tested without a database.
 */
export function summarizeConnection(
  connection: Connection,
  environment: "sandbox" | "production",
): ConnectionSummary {
  return {
    realmId: connection.realmId,
    environment,
    companyName: connection.companyName,
    connectedBy: {
      email: connection.email,
      verified: connection.emailVerified,
    },
    connectedAt: iso(connection.createdAt),
    lastRefreshAt: iso(connection.refreshUpdatedAt),
    writesEnabled: connection.writesEnabled,
  };
}
