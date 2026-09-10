import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./log.js";
import { RateLimiter } from "./rate-limit.js";
import { createMcpServer } from "./server.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  connectionId: string;
  lastActive: number;
}

const sessions = new Map<string, Session>();

// Per-connection tool-call rate limit. Generous for interactive use; stops a
// runaway client from hammering QuickBooks (and Intuit's per-app quota).
const limiter = new RateLimiter(120, 60_000);

/**
 * How long an idle session is held. Eviction is graceful now (see
 * `sessionNotFound`), but re-initialising still costs a round trip and resets
 * the client's tool list, so this is long enough that a close which pauses for
 * a meeting resumes on the same session.
 */
const SESSION_IDLE_MS = 8 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

// The two JSON-RPC codes the MCP spec (and the SDK) use for session failures.
const INVALID_REQUEST_CODE = -32000;
const SESSION_NOT_FOUND_CODE = -32001;

function connectionIdFrom(req: Request): string | undefined {
  const extra = req.auth?.extra as { connectionId?: unknown } | undefined;
  return typeof extra?.connectionId === "string"
    ? extra.connectionId
    : undefined;
}

function sessionIdFrom(req: Request): string | undefined {
  const value = req.headers["mcp-session-id"];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function toolNameFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { method?: unknown; params?: { name?: unknown } };
  if (b.method !== "tools/call") return null;
  return typeof b.params?.name === "string" ? b.params.name : null;
}

/** True when the body — single or batched — opens a new MCP session. */
function isInitializing(body: unknown): boolean {
  return Array.isArray(body)
    ? body.some(isInitializeRequest)
    : isInitializeRequest(body);
}

/** A JSON-RPC error response, so a rejection still parses as a protocol reply. */
function rpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

/**
 * Answer a request for a session we don't hold with 404 — the spec's
 * expired-session signal, and the one status that makes a client re-initialise
 * on its own.
 *
 * This is the fix for the defect that made unattended runs impossible. The
 * server evicts idle sessions, and a request naming an evicted session used to
 * fall through to a *fresh* transport, whose first act is to reject any
 * non-initialize request with 400 "Server not initialized". Clients treat that
 * 400 as a protocol error and retry it verbatim, so a session that died
 * mid-run never recovered until someone disconnected and re-authenticated by
 * hand — 31% of production requests were that 400.
 *
 * A session owned by another connection answers the same way, so a token for
 * one connection cannot discover another connection's session ids.
 */
function sessionNotFound(
  req: Request,
  res: Response,
  connectionId: string,
  sessionId: string,
  ownedByOther: boolean,
): void {
  rpcError(res, 404, SESSION_NOT_FOUND_CODE, "Session not found");
  log.warn(
    { connectionId, sessionId, ownedByOther, method: req.method },
    "session_not_found",
  );
}

/**
 * Answer a non-initialize request that names no session at all with 400, as
 * the spec prescribes. Logged under its own name so it stays distinguishable
 * from the 404 above: both were 400s before, which made "the session died" and
 * "the client sent no session id" impossible to tell apart in the logs.
 */
function sessionIdMissing(
  req: Request,
  res: Response,
  connectionId: string,
): void {
  rpcError(
    res,
    400,
    INVALID_REQUEST_CODE,
    "Bad Request: Mcp-Session-Id header is required",
  );
  log.warn({ connectionId, method: req.method }, "session_id_missing");
}

/** One structured line per request, emitted when the response finishes. */
function logWhenFinished(
  req: Request,
  res: Response,
  connectionId: string,
): void {
  const start = process.hrtime.bigint();
  const tool = toolNameFrom(req.body);
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    log.info(
      { connectionId, method: req.method, tool, status: res.statusCode, ms },
      "mcp_request",
    );
  });
}

async function evict(sessionId: string, session: Session): Promise<void> {
  sessions.delete(sessionId);
  try {
    await session.server.close();
  } catch (err) {
    log.warn({ sessionId, err: String(err) }, "session_close_failed");
  }
}

/** Start the background sweep that reaps idle sessions and stale rate windows. */
export function startSessionReaper(): void {
  setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, session] of sessions) {
      if (session.lastActive < cutoff) void evict(id, session);
    }
    limiter.sweep();
  }, SWEEP_INTERVAL_MS).unref();
}

export const handleMcpPost: RequestHandler = async (req, res) => {
  const connectionId = connectionIdFrom(req);
  if (!connectionId) {
    res
      .status(401)
      .json({ error: "no QuickBooks connection bound to this token" });
    return;
  }

  const rl = limiter.check(connectionId);
  if (!rl.allowed) {
    res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
    res.status(429).json({ error: "rate_limited" });
    log.warn({ connectionId }, "rate_limited");
    return;
  }

  logWhenFinished(req, res, connectionId);

  const sessionId = sessionIdFrom(req);

  if (!isInitializing(req.body)) {
    if (!sessionId) {
      sessionIdMissing(req, res, connectionId);
      return;
    }
    const session = sessions.get(sessionId);
    if (!session || session.connectionId !== connectionId) {
      sessionNotFound(req, res, connectionId, sessionId, Boolean(session));
      return;
    }
    session.lastActive = Date.now();
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // An initialize always starts a fresh session, even when the client sends a
  // stale session id alongside it. Retire whatever session it named so a client
  // that reconnects repeatedly doesn't leave one behind on every attempt.
  if (sessionId) {
    const stale = sessions.get(sessionId);
    if (stale?.connectionId === connectionId) await evict(sessionId, stale);
  }

  const server = createMcpServer(connectionId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  if (transport.sessionId) {
    sessions.set(transport.sessionId, {
      transport,
      server,
      connectionId,
      lastActive: Date.now(),
    });
  }
};

/** GET /mcp — SSE stream for an established session. */
export const handleMcpGet: RequestHandler = async (req, res) => {
  await withSession(req, res, (session) =>
    session.transport.handleRequest(req, res),
  );
};

/** DELETE /mcp — tear a session down. */
export const handleMcpDelete: RequestHandler = async (req, res) => {
  await withSession(req, res, async (session, sessionId) => {
    await session.transport.handleRequest(req, res);
    await evict(sessionId, session);
  });
};

async function withSession(
  req: Request,
  res: Response,
  fn: (session: Session, sessionId: string) => void | Promise<void>,
): Promise<void> {
  const connectionId = connectionIdFrom(req);
  if (!connectionId) {
    res
      .status(401)
      .json({ error: "no QuickBooks connection bound to this token" });
    return;
  }

  logWhenFinished(req, res, connectionId);

  const sessionId = sessionIdFrom(req);
  if (!sessionId) {
    sessionIdMissing(req, res, connectionId);
    return;
  }
  const session = sessions.get(sessionId);
  if (!session || session.connectionId !== connectionId) {
    sessionNotFound(req, res, connectionId, sessionId, Boolean(session));
    return;
  }
  session.lastActive = Date.now();
  await fn(session, sessionId);
}
