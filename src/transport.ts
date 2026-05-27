import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  close: () => Promise<void>;
}

const sessions = new Map<string, Session>();

/** The connection id is stamped onto req.auth.extra by the bearer middleware. */
function connectionIdFrom(req: Request): string | undefined {
  const extra = req.auth?.extra as { connectionId?: unknown } | undefined;
  return typeof extra?.connectionId === "string"
    ? extra.connectionId
    : undefined;
}

/**
 * POST /mcp — route to an existing session, or initialise a new one bound to
 * the caller's QuickBooks connection. New server + transport per session; the
 * session map is keyed by the SDK-generated mcp-session-id.
 */
export const handleMcpPost: RequestHandler = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }

  const connectionId = connectionIdFrom(req);
  if (!connectionId) {
    res
      .status(401)
      .json({ error: "no QuickBooks connection bound to this token" });
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
      close: async () => {
        await server.close();
      },
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
    await session.close();
    sessions.delete(sessionId);
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
  await fn(session, sessionId);
}
