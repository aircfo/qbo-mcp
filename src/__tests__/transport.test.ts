import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The transport pulls in every tool module, and those reach for the composition
// root — which opens the database and builds the Intuit clients. None of that is
// exercised by session handling, so it is replaced wholesale.
vi.mock("../deps.js", () => ({
  clientManager: { getClient: vi.fn() },
  connectionStore: { get: vi.fn(), create: vi.fn(), delete: vi.fn() },
  oauthStore: { revokeConnectionTokens: vi.fn() },
  intuitOAuth: { revoke: vi.fn() },
  oauthProvider: {},
}));

const { handleMcpDelete, handleMcpGet, handleMcpPost } =
  await import("../transport.js");

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
};
const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

/** The connection the stub bearer resolves to; swapped to act as another tenant. */
let callerConnectionId = "connection-a";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      token: "stub",
      clientId: "test-client",
      scopes: [],
      extra: { connectionId: callerConnectionId },
    };
    next();
  });
  app.post("/mcp", handleMcpPost);
  app.get("/mcp", handleMcpGet);
  app.delete("/mcp", handleMcpDelete);

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Reply {
  status: number;
  sessionId: string | null;
  body: string;
}

async function call(
  method: "POST" | "GET" | "DELETE",
  opts: { sessionId?: string; body?: unknown } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { accept: MCP_ACCEPT };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;

  const res = await fetch(baseUrl, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    body: await res.text(),
  };
}

/** Open a session and return its id. */
async function openSession(): Promise<string> {
  const reply = await call("POST", { body: INITIALIZE });
  expect(reply.status).toBe(200);
  expect(reply.sessionId).toBeTruthy();
  return reply.sessionId as string;
}

function rpcErrorCode(body: string): number | undefined {
  const parsed: unknown = JSON.parse(body);
  const error = (parsed as { error?: { code?: unknown } }).error;
  return typeof error?.code === "number" ? error.code : undefined;
}

describe("MCP transport sessions", () => {
  it("issues a session id for an initialize request", async () => {
    const sessionId = await openSession();
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("serves a request on a live session", async () => {
    const sessionId = await openSession();
    const reply = await call("POST", { sessionId, body: TOOLS_LIST });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("get_company_info");
  });

  it("answers 404 for a session the server no longer holds", async () => {
    const reply = await call("POST", {
      sessionId: "11111111-2222-3333-4444-555555555555",
      body: TOOLS_LIST,
    });
    expect(reply.status).toBe(404);
    expect(rpcErrorCode(reply.body)).toBe(-32001);
  });

  it("answers 400 when a non-initialize request names no session", async () => {
    const reply = await call("POST", { body: TOOLS_LIST });
    expect(reply.status).toBe(400);
    expect(rpcErrorCode(reply.body)).toBe(-32000);
  });

  it("hides another connection's session behind the same 404", async () => {
    const sessionId = await openSession();
    callerConnectionId = "connection-b";
    try {
      const reply = await call("POST", { sessionId, body: TOOLS_LIST });
      expect(reply.status).toBe(404);
      expect(rpcErrorCode(reply.body)).toBe(-32001);
    } finally {
      callerConnectionId = "connection-a";
    }
  });

  it("starts a fresh session when an initialize carries a stale session id", async () => {
    const stale = await openSession();
    const reply = await call("POST", {
      sessionId: stale,
      body: INITIALIZE,
    });
    expect(reply.status).toBe(200);
    expect(reply.sessionId).toBeTruthy();
    expect(reply.sessionId).not.toBe(stale);
  });

  it("answers 404 on GET and DELETE for an unknown session", async () => {
    const unknown = "99999999-8888-7777-6666-555555555555";
    const get = await call("GET", { sessionId: unknown });
    expect(get.status).toBe(404);
    expect(rpcErrorCode(get.body)).toBe(-32001);

    const del = await call("DELETE", { sessionId: unknown });
    expect(del.status).toBe(404);
    expect(rpcErrorCode(del.body)).toBe(-32001);
  });

  it("answers 400 on GET with no session id", async () => {
    const reply = await call("GET");
    expect(reply.status).toBe(400);
    expect(rpcErrorCode(reply.body)).toBe(-32000);
  });

  it("closes a session on DELETE, and the next call gets a 404", async () => {
    const sessionId = await openSession();
    const deleted = await call("DELETE", { sessionId });
    expect(deleted.status).toBeLessThan(300);

    const after = await call("POST", { sessionId, body: TOOLS_LIST });
    expect(after.status).toBe(404);
    expect(rpcErrorCode(after.body)).toBe(-32001);
  });
});
