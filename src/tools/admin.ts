import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { connectionStore, intuitOAuth, oauthStore } from "../deps.js";
import { log } from "../log.js";
import { json, toolError } from "./_format.js";

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Tools for the people in `ADMIN_USERS`, registered only for their sessions so
 * they do not appear in anyone else's tool list.
 *
 * These exist because the server had no way to answer "who is connected to
 * what" or to end someone else's access without opening the database by hand.
 * Everything here reads or writes our own rows; none of it touches a ledger.
 */
export function registerAdminTools(
  server: McpServer,
  adminEmail: string,
): void {
  server.registerTool(
    "list_connections",
    {
      description:
        "Administrative: every QuickBooks connection this server holds — id, realm, company, who authorized it, whether that identity is verified, whether writes are enabled, and when it last refreshed. Never returns credentials.",
    },
    async () =>
      json(
        connectionStore.listSummaries().map((row) => ({
          connectionId: row.id,
          realmId: row.realm_id,
          companyName: row.company_name,
          authorizedBy: row.email,
          identityVerified: row.email_verified === 1,
          writesEnabled: row.writes_enabled === 1,
          connectedAt: iso(row.created_at),
          lastRefreshAt: iso(row.refresh_updated_at),
        })),
      ),
  );

  server.registerTool(
    "revoke_connection",
    {
      description:
        "Administrative: end one connection. Revokes its QuickBooks access with Intuit, invalidates every token issued for it, and deletes the stored row. The person has to re-authorize to use the connector again. Use for offboarding, a lost device, or clearing an orphaned connection.",
      inputSchema: {
        connection_id: z
          .string()
          .describe("The connection id from list_connections."),
      },
    },
    async ({ connection_id }) => {
      const connection = connectionStore.get(connection_id);
      if (!connection) {
        return toolError(`No connection with id ${connection_id}.`);
      }

      // Best-effort upstream revoke, then local teardown regardless: access
      // must be endable even when Intuit is unreachable.
      try {
        await intuitOAuth.revoke(connection.refreshToken);
      } catch (err) {
        log.warn(
          { connectionId: connection_id, err: String(err) },
          "intuit_revoke_failed",
        );
      }
      oauthStore.revokeConnectionTokens(connection_id);
      connectionStore.delete(connection_id);

      log.info(
        {
          connectionId: connection_id,
          realmId: connection.realmId,
          revokedBy: adminEmail,
        },
        "connection_revoked",
      );
      return json({
        revoked: true,
        connectionId: connection_id,
        company: connection.companyName ?? connection.realmId,
      });
    },
  );

  server.registerTool(
    "set_writes_enabled",
    {
      description:
        "Administrative: turn write tools on or off for one connection. Off by default on every connection. A connection also needs the server-wide write switch enabled before any write tool appears.",
      inputSchema: {
        connection_id: z
          .string()
          .describe("The connection id from list_connections."),
        enabled: z
          .boolean()
          .describe("True to allow writes, false to stop them."),
      },
    },
    async ({ connection_id, enabled }) => {
      const connection = connectionStore.get(connection_id);
      if (!connection) {
        return toolError(`No connection with id ${connection_id}.`);
      }
      connectionStore.setWritesEnabled(connection_id, enabled);
      log.info(
        { connectionId: connection_id, enabled, changedBy: adminEmail },
        "writes_enabled_changed",
      );
      return json({
        connectionId: connection_id,
        company: connection.companyName ?? connection.realmId,
        writesEnabled: enabled,
        note: enabled
          ? "Writes are allowed for this connection once the server-wide switch is on. The session must be re-initialized to see the tools."
          : "Writes are off for this connection.",
      });
    },
  );
}
