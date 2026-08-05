import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// Evict idle sessions so the in-memory map can't grow without bound when
// clients disconnect without sending DELETE /mcp.
const SESSION_IDLE_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

function connectionIdFrom(req: Request): string | undefined {
  const extra = req.auth?.extra as { connectionId?: unknown } | undefined;
  return typeof extra?.connectionId === "string"
    ? extra.connectionId
    : undefined;
}

function toolNameFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { method?: unknown; params?: { name?: unknown } };
  if (b.method !== "tools/call") return null;
  return typeof b.params?.name === "string" ? b.params.name : null;
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

  // One structured line per request, emitted when the response finishes.
  const start = process.hrtime.bigint();
  const tool = toolNameFrom(req.body);
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    log.info({ connectionId, tool, status: res.statusCode, ms }, "mcp_request");
  });

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    // Defense-in-depth for a multi-tenant server: a session must be driven by
    // the same connection that created it. Session ids are unguessable, but we
    // never want a token for connection B to operate connection A's session.
    // Answer 404 (not 403): the spec's expired-session signal makes the client
    // re-initialize with its own token, and it avoids confirming that the
    // session id exists under another tenant. A 403 here surfaces to users as
    // a fatal "blocked by a firewall" permission error after any re-auth or
    // plugin migration that leaves a live session behind.
    if (existing.connectionId !== connectionId) {
      res.status(404).json({ error: "session not found" });
      log.warn({ connectionId, sessionId }, "session_connection_mismatch");
      return;
    }
    existing.lastActive = Date.now();
    await existing.transport.handleRequest(req, res, req.body);
    return;
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
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!sessionId || !session) {
    res.status(400).json({ error: "invalid or missing session id" });
    return;
  }
  // Same ownership guard (and same 404-over-403 reasoning) as handleMcpPost.
  if (session.connectionId !== connectionIdFrom(req)) {
    res.status(404).json({ error: "session not found" });
    log.warn(
      { connectionId: connectionIdFrom(req), sessionId },
      "session_connection_mismatch",
    );
    return;
  }
  session.lastActive = Date.now();
  await fn(session, sessionId);
}
