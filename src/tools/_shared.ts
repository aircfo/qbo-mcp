import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type QuickBooks from "node-quickbooks";
import { clientManager } from "../deps.js";
import { ReauthRequiredError } from "../qbo/client-manager.js";
import { json, toolError } from "./_format.js";

/**
 * Resolve a per-connection QuickBooks client, run a call against it, and wrap
 * the result as an MCP tool response. Centralises auth/error handling so each
 * tool body is just the QBO call itself.
 */
export async function runQbo(
  connectionId: string,
  run: (qb: QuickBooks, realmId: string) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const { qb, realmId } = await clientManager.getClient(connectionId);
    return json(await run(qb, realmId));
  } catch (err) {
    if (err instanceof ReauthRequiredError) return toolError(err.message);
    return toolError(
      `QuickBooks request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
