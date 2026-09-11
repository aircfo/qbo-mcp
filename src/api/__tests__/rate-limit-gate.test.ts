import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RateLimiter } from "../../rate-limit.js";
import { requireServicePrincipal } from "../auth.js";

const TOKEN = "r".repeat(48);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(
    requireServicePrincipal({
      token: TOKEN,
      principalId: "svc:limited",
      // Two per minute, so the limit is reachable without 300 requests.
      limiter: new RateLimiter(2, 60_000),
    }),
  );
  app.get("/ping", (req, res) => res.json({ principal: req.principal?.id }));

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/ping`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const authorized = { authorization: `Bearer ${TOKEN}` };

describe("service principal rate limiting", () => {
  it("turns the caller away once its window is spent, and says when to retry", async () => {
    const first = await fetch(baseUrl, { headers: authorized });
    const second = await fetch(baseUrl, { headers: authorized });
    const third = await fetch(baseUrl, { headers: authorized });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: "rate_limited" });
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("puts the principal on the request for the handler behind it", async () => {
    const app = express();
    app.use(
      requireServicePrincipal({
        token: TOKEN,
        principalId: "svc:named",
        limiter: new RateLimiter(10, 60_000),
      }),
    );
    app.get("/who", (req, res) => res.json({ principal: req.principal?.id }));
    const local = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const { port } = local.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/who`, {
      headers: authorized,
    });
    expect(await res.json()).toEqual({ principal: "svc:named" });

    await new Promise<void>((resolve) => local.close(() => resolve()));
  });
});
