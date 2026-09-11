import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSummaryRow } from "../../store/connection-store.js";
import { serviceApiRouter } from "../index.js";

const TOKEN = "s".repeat(48);
const PRINCIPAL = "svc:test-pipeline";
const NOW = Date.now();
const DAY = 24 * 60 * 60_000;

const SUMMARY: ConnectionSummaryRow = {
  id: "conn-1",
  realm_id: "793988035",
  company_name: "airCFO",
  email: "alex@aircfo.com",
  email_verified: 1,
  writes_enabled: 0,
  created_at: NOW - 30 * DAY,
  refresh_updated_at: NOW - DAY,
};

let rows: ConnectionSummaryRow[] = [SUMMARY];
let server: Server;
let baseUrl: string;

/** Every line the router logged during one test, for the never-log-the-token assertions. */
let logged: string[] = [];

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });

  const app = express();
  app.use(
    "/api",
    serviceApiRouter({
      token: TOKEN,
      principalId: PRINCIPAL,
      connections: { listSummaries: () => rows },
    }),
  );

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  rows = [SUMMARY];
  logged = [];
});

function get(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/connections`, { headers });
}

const authorized = { authorization: `Bearer ${TOKEN}` };

/**
 * `api_request` is written from `res.on("finish")`, which the server may reach
 * after fetch has already resolved for the client. Wait for the line rather
 * than assuming it has landed.
 */
async function waitForLog(
  predicate: (line: string) => boolean,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = logged.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("no matching log line was written");
}

describe("service principal authentication", () => {
  it("lets a correct token through to the handler", async () => {
    const res = await get(authorized);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connections: unknown[] };
    expect(body.connections).toHaveLength(1);
  });

  it("rejects a wrong token of the same length", async () => {
    const res = await get({ authorization: `Bearer ${"x".repeat(48)}` });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a wrong token of a different length without throwing", async () => {
    // timingSafeEqual throws on a length mismatch, so a naive comparison would
    // 500 here instead of 401.
    const res = await get({ authorization: "Bearer short" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing header and says how to authenticate", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects a non-Bearer authorization scheme", async () => {
    const res = await get({ authorization: `Token ${TOKEN}` });
    expect(res.status).toBe(401);
  });

  it("never writes the token to a log line, on success or on rejection", async () => {
    await get(authorized);
    await get({ authorization: "Bearer wrong-but-long-enough-to-be-real" });
    await get();
    await waitForLog((line) => line.includes("api_request"));
    await waitForLog((line) => line.includes("service_auth_rejected"));

    for (const line of logged) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("wrong-but-long-enough-to-be-real");
    }
  });

  it("logs the same full path whether a route matched or not", async () => {
    // req.path is mount-relative and req.baseUrl is restored before the finish
    // handler runs, so a matched route and a fall-through once disagreed.
    await fetch(`${baseUrl}/api/connections?ignored=1`, { headers: authorized });
    await fetch(`${baseUrl}/api/connections`, {
      method: "POST",
      headers: authorized,
    });

    const matched = await waitForLog(
      (line) => line.includes("api_request") && line.includes('"status":200'),
    );
    const fellThrough = await waitForLog(
      (line) => line.includes("api_request") && line.includes('"status":404'),
    );

    for (const line of [matched, fellThrough]) {
      const parsed = JSON.parse(line) as { path: string };
      expect(parsed.path).toBe("/api/connections");
    }
  });

  it("logs an api_request line naming the principal", async () => {
    await get(authorized);
    const line = await waitForLog((entry) => entry.includes("api_request"));
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.principal).toBe(PRINCIPAL);
    expect(parsed.status).toBe(200);
    expect(parsed.path).toBe("/api/connections");
  });
});

describe("GET /api/connections", () => {
  it("never returns the address that authorized a connection", async () => {
    const res = await get(authorized);
    const text = await res.text();
    expect(text).not.toContain("alex@aircfo.com");
    expect(text).not.toContain("email");
  });

  it("returns dates as ISO strings rather than epoch numbers", async () => {
    const res = await get(authorized);
    const body = (await res.json()) as {
      connections: { connectedAt: string; lastRefreshAt: string }[];
    };
    expect(body.connections[0].connectedAt).toBe(
      new Date(SUMMARY.created_at).toISOString(),
    );
    expect(body.connections[0].lastRefreshAt).toBe(
      new Date(SUMMARY.refresh_updated_at).toISOString(),
    );
  });

  it("returns an empty list rather than failing on a fresh database", async () => {
    rows = [];
    const res = await get(authorized);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connections: [] });
  });
});
