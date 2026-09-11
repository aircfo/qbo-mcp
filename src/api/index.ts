import { Router } from "express";
import { logApiRequest, requireServicePrincipal } from "./auth.js";
import { connectionsHandler, type ConnectionsSource } from "./connections.js";

export interface ServiceApiOptions {
  token: string;
  principalId: string;
  connections: ConnectionsSource;
}

/**
 * The service door: how a scheduled job reaches this server, given it cannot
 * sign in as a person.
 *
 * READ-ONLY, PERMANENTLY. No endpoint that changes a client's books is ever
 * added here, whatever the MCP tools grow later. Writes need a named human
 * approving a specific batch, and a shared secret held by a machine cannot
 * satisfy that.
 *
 * The caller builds this only when a token is configured, so with no token the
 * routes do not exist rather than existing and refusing.
 */
export function serviceApiRouter(options: ServiceApiOptions): Router {
  const router = Router();
  router.use(
    requireServicePrincipal({
      token: options.token,
      principalId: options.principalId,
    }),
  );
  router.use(logApiRequest);
  router.get("/connections", connectionsHandler(options.connections));
  return router;
}
