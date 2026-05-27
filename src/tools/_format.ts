import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Pure tool-result + param helpers. Deliberately free of any app dependencies
 * (no deps.ts, no env) so they're trivially unit-testable.
 */

/** Compact JSON (no pretty-print) to keep large QBO payloads token-cheap. */
export function json(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Promisify a node-quickbooks callback method. */
export function promisify<T>(
  run: (cb: (err: unknown, data: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** Drop undefined keys so optional, unset params aren't forwarded to QBO. */
export function definedOnly<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
