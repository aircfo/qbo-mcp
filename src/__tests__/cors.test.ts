import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The CORS middleware from `src/index.ts`, reproduced here because that module
 * opens the database and starts listening on import.
 *
 * It exists as a test because scoping this to `/mcp` once looked like tidying
 * and was a regression: a browser MCP client fetches OAuth discovery,
 * registration and token endpoints cross-origin from the app *root*, long
 * before it holds a bearer for `/mcp`.
 */
function corsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.header("Access-Control-Allow-Origin", "*");
    next();
  };
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(corsMiddleware());
  app.use((_req, res) => res.json({ ok: true }));

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function allowOrigin(path: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}${path}`);
  return res.headers.get("access-control-allow-origin");
}

describe("CORS scope", () => {
  // Every path a browser-based MCP client touches before it has a token.
  it.each([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/register",
    "/authorize",
    "/token",
    "/revoke",
    "/mcp",
  ])("allows a cross-origin browser client on %s", async (path) => {
    expect(await allowOrigin(path)).toBe("*");
  });

  it.each(["/api", "/api/connections", "/api/reports/profit-and-loss"])(
    "does not advertise a cross-origin policy on %s",
    async (path) => {
      expect(await allowOrigin(path)).toBeNull();
    },
  );

  it("does not mistake a path merely beginning with api for the service door", async () => {
    expect(await allowOrigin("/apidocs")).toBe("*");
  });
});
