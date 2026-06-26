import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompanyTools } from "./tools/company.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerLedgerTools } from "./tools/ledger.js";
import { registerReportTools } from "./tools/reports.js";

/**
 * Build a fresh MCP server bound to one connection. Tool modules close over
 * `connectionId` and resolve a per-request QuickBooks client from it, so a
 * session only ever touches its own company's data.
 *
 * v1 is read-only: company info, financial reports (Batch A), and ledger
 * read/search (Batch B).
 */
export function createMcpServer(connectionId: string): McpServer {
  const server = new McpServer({ name: "airCFO QuickBooks", version: "0.0.1" });
  registerCompanyTools(server, connectionId);
  registerReportTools(server, connectionId);
  registerLedgerTools(server, connectionId);
  registerConnectionTools(server, connectionId);
  return server;
}
