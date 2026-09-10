import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type QuickBooks from "node-quickbooks";
import { clientManager } from "../deps.js";
import { log } from "../log.js";
import { ReauthRequiredError } from "../qbo/client-manager.js";
import {
  TimeoutError,
  json,
  qboErrorMessage,
  qboStatus,
  toolError,
  withTimeout,
} from "./_format.js";

/**
 * Deadline for one attempt at a QuickBooks call. Chosen to fail well inside
 * the ~120s at which clients and the platform edge give up, so a stalled call
 * returns a useful tool error instead of a bare 504 the model can't read.
 */
const CALL_TIMEOUT_MS = 45_000;

/** Statuses worth a second attempt: Intuit throttling and transient faults. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Backoff before each retry. Two entries = at most three attempts. */
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Only retry a failure that arrived quickly. A slow failure means Intuit is
 * struggling rather than blipping, and retrying it would push the total past
 * the caller's own timeout — turning a readable error into a dead request.
 */
const RETRY_BUDGET_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one QBO call with a deadline, retrying transient upstream failures.
 * Every tool goes through here, so the guarantee lives in one place rather
 * than in each tool remembering to bound its own call.
 */
async function callQbo<T>(
  connectionId: string,
  tag: string,
  call: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTimeout(call, CALL_TIMEOUT_MS, "QuickBooks request");
    } catch (err) {
      const status = qboStatus(err);
      const delayMs = RETRY_DELAYS_MS[attempt];
      const elapsedMs = Date.now() - startedAt;
      const retryable =
        status !== undefined &&
        RETRYABLE_STATUSES.has(status) &&
        delayMs !== undefined &&
        elapsedMs <= RETRY_BUDGET_MS;

      const fields = {
        connectionId,
        tag,
        status,
        attempt: attempt + 1,
        ms: elapsedMs,
        timedOut: err instanceof TimeoutError,
        err: qboErrorMessage(err),
      };
      if (!retryable) {
        log.warn(fields, "qbo_upstream_error");
        throw err;
      }
      log.warn({ ...fields, retryInMs: delayMs }, "qbo_upstream_retry");
      await sleep(delayMs);
    }
  }
}

/**
 * Resolve a per-connection QuickBooks client, run a call against it, and wrap
 * the result as an MCP tool response. Centralises auth, deadlines, retries and
 * error shaping so each tool body is just the QBO call itself.
 */
export async function runQbo(
  connectionId: string,
  run: (qb: QuickBooks, realmId: string) => Promise<unknown>,
  tag = "qbo",
): Promise<CallToolResult> {
  try {
    const { qb, realmId } = await clientManager.getClient(connectionId);
    return json(await callQbo(connectionId, tag, () => run(qb, realmId)));
  } catch (err) {
    if (err instanceof ReauthRequiredError) return toolError(err.message);
    if (err instanceof TimeoutError) {
      return toolError(
        `${err.message}. QuickBooks did not answer in time — narrow the date range, the columns or the filters and try again.`,
      );
    }
    return toolError(`QuickBooks request failed: ${qboErrorMessage(err)}`);
  }
}
