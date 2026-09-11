import type { ConnectionSummaryRow } from "../store/connection-store.js";

/**
 * Intuit's refresh tokens live about 100 days and are renewed on use, so a
 * connection whose last refresh is older than this is almost certainly dead.
 * The threshold is deliberately short of Intuit's, to flag a company shortly
 * before it fails rather than after.
 */
export const STALE_REFRESH_MS = 90 * 24 * 60 * 60_000;

export type ConnectionStatus = "ok" | "needs_reconnect";

export interface RealmConnection {
  realmId: string;
  companyName: string | null;
  connectionId: string;
  status: ConnectionStatus;
  connectedAt: number;
  lastRefreshAt: number;
}

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
    status: statusOf(row, now),
    connectedAt: row.created_at,
    lastRefreshAt: row.refresh_updated_at,
  }));
}

function statusOf(row: ConnectionSummaryRow, now: number): ConnectionStatus {
  if (row.email_verified !== 1) return "needs_reconnect";
  if (now - row.refresh_updated_at > STALE_REFRESH_MS) return "needs_reconnect";
  return "ok";
}
