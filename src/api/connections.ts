import type { Request, Response } from "express";
import type { ConnectionSummaryRow } from "../store/connection-store.js";
import { selectConnections } from "./connections-logic.js";

export interface ConnectionsSource {
  listSummaries(): ConnectionSummaryRow[];
}

/**
 * Which companies a scheduled job can pull today.
 *
 * Reads only our own database and never calls QuickBooks, so it still answers
 * when Intuit is unavailable — which is exactly when a pipeline most needs to
 * know what it is looking at.
 *
 * The rows carry `email`, the address of the teammate who authorized each
 * connection. It is dropped here rather than filtered downstream: the pipeline
 * has no use for it, and the safest field is one that is never sent.
 *
 * The response is an object rather than a bare array so that adding a field
 * later is not a breaking change for a caller already in production.
 */
export function connectionsHandler(source: ConnectionsSource) {
  return (_req: Request, res: Response): void => {
    const connections = selectConnections(source.listSummaries()).map(
      (entry) => ({
        realmId: entry.realmId,
        companyName: entry.companyName,
        connectionId: entry.connectionId,
        status: entry.status,
        connectedAt: new Date(entry.connectedAt).toISOString(),
        lastRefreshAt: new Date(entry.lastRefreshAt).toISOString(),
      }),
    );
    res.json({ connections });
  };
}
