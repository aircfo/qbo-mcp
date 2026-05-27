import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { connectionStore, intuitOAuth, oauthStore } from "../deps.js";
import { log } from "../log.js";
import { json, toolError } from "./_format.js";

export function registerConnectionTools(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    "disconnect_quickbooks",
    {
      description:
        "Disconnect this QuickBooks company: revokes the connection with QuickBooks, deletes the stored tokens, and ends access. You'll need to reconnect (re-authorize) to use the tools again. Use this to offboard or if a device is lost.",
    },
    async () => {
      const conn = connectionStore.get(connectionId);
      if (!conn)
        return toolError("No active QuickBooks connection to disconnect.");

      // Best-effort upstream revoke; proceed with local teardown regardless so a
      // user can always sever access even if Intuit's revoke endpoint is down.
      try {
        await intuitOAuth.revoke(conn.refreshToken);
      } catch (err) {
        log.warn({ connectionId, err: String(err) }, "intuit_revoke_failed");
      }

      oauthStore.revokeConnectionTokens(connectionId);
      connectionStore.delete(connectionId);
      log.info(
        { connectionId, realmId: conn.realmId },
        "connection_disconnected",
      );

      return json({
        disconnected: true,
        company: conn.companyName ?? conn.realmId,
        note: "Access revoked. Re-authorize to reconnect.",
      });
    },
  );
}
