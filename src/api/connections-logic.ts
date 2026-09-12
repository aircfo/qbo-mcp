import type { ConnectionSummaryRow } from "../store/connection-store.js";

/**
 * Intuit's refresh tokens live about 100 days and are renewed on use, so a
 * connection whose last refresh is older than this is almost certainly dead.
 * The threshold is deliberately short of Intuit's, to flag a company shortly
 * before it fails rather than after.
 */
export const STALE_REFRESH_MS = 90 * 24 * 60 * 60_000;

/**
 * Why a connection needs reconnecting. `unverified` means the row predates the
 * identity gate and no verified person has re-authorized it; every other door
 * refuses such a row on sight. `stale` is only a prediction that Intuit has
 * dropped the authorization, and using the credential is the one way to know.
 */
export type ReconnectReason = "unverified" | "stale";

type ConnectionHealth =
  | { status: "ok" }
  | { status: "needs_reconnect"; reason: ReconnectReason };

export type ConnectionStatus = ConnectionHealth["status"];

export type RealmConnection = {
  realmId: string;
  companyName: string | null;
  connectionId: string;
  connectedAt: number;
  lastRefreshAt: number;
} & ConnectionHealth;

/**
 * Which row represents a realm: a verified identity beats an unverified one
 * whatever the dates, and among equals the most recently refreshed wins.
 */
function better(
  candidate: ConnectionSummaryRow,
  incumbent: ConnectionSummaryRow,
): boolean {
  if (candidate.email_verified !== incumbent.email_verified) {
    return candidate.email_verified > incumbent.email_verified;
  }
  return candidate.refresh_updated_at > incumbent.refresh_updated_at;
}

/**
 * Collapse the connection table to one entry per QuickBooks company.
 *
 * Several teammates can connect the same company, so the table holds several
 * rows for one realm. A scheduled job should not have to choose between them,
 * so the choice is made here — and step 2's report lookup must resolve a realm
 * by calling this, not by repeating the rule.
 *
 * `status` is inferred, because there is no revoked column: a realm with no
 * verified row predates the identity gate, and a stale refresh means Intuit
 * has almost certainly dropped the authorization. Neither is authoritative —
 * only using a credential proves it still works — so a caller should read
 * `needs_reconnect` as "worth alerting a human about".
 *
 * Pure, including the clock, so every shape is testable without a database.
 */
export function selectConnections(
  rows: readonly ConnectionSummaryRow[],
  now: number = Date.now(),
): RealmConnection[] {
  const best = new Map<string, ConnectionSummaryRow>();
  for (const row of rows) {
    const incumbent = best.get(row.realm_id);
    if (!incumbent || better(row, incumbent)) best.set(row.realm_id, row);
  }

  return [...best.values()].map((row) => ({
    realmId: row.realm_id,
    companyName: row.company_name,
    connectionId: row.id,
    connectedAt: row.created_at,
    lastRefreshAt: row.refresh_updated_at,
    ...healthOf(row, now),
  }));
}

/**
 * `unverified` outranks `stale`: a row from before the identity gate must be
 * re-authorized whatever its refresh date says.
 */
function healthOf(row: ConnectionSummaryRow, now: number): ConnectionHealth {
  if (row.email_verified !== 1) {
    return { status: "needs_reconnect", reason: "unverified" };
  }
  if (now - row.refresh_updated_at > STALE_REFRESH_MS) {
    return { status: "needs_reconnect", reason: "stale" };
  }
  return { status: "ok" };
}
