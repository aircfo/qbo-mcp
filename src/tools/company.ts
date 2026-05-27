import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { promisify } from "./_format.js";
import { runQbo } from "./_shared.js";

export function registerCompanyTools(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    "get_company_info",
    {
      description:
        "Get the connected QuickBooks company's profile: legal/display name, address, fiscal-year start, country, and base currency.",
    },
    async () =>
      runQbo(connectionId, (qb, realmId) =>
        promisify((cb) => qb.getCompanyInfo(realmId, cb)),
      ),
  );
}
