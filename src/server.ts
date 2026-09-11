import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAdmin } from "./auth/access.js";
import { connectionStore } from "./deps.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerCompanyTools } from "./tools/company.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerLedgerTools } from "./tools/ledger.js";
import { registerReportTools } from "./tools/reports.js";

/**
 * Build a fresh MCP server bound to one connection. Tool modules close over
 * `connectionId` and resolve a per-request QuickBooks client from it, so a
 * session only ever touches its own company's data.
 *
 * The data tools are read-only. The administrative tools are registered only
 * for a session whose verified identity is in `ADMIN_USERS`, so they are
 * absent from everyone else's tool list rather than present and refusing.
 */
export function createMcpServer(connectionId: string): McpServer {
  const server = new McpServer({
    name: "airCFO QBO Gateway",
    version: "0.0.1",
  });
  registerCompanyTools(server, connectionId);
  registerReportTools(server, connectionId);
  registerLedgerTools(server, connectionId);
  registerConnectionTools(server, connectionId);

  const email = connectionStore.get(connectionId)?.email ?? null;
  if (isAdmin(email) && email) registerAdminTools(server, email);

  return server;
}
