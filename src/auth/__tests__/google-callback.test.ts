import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { GoogleIdentity } from "../google-idp.js";

const stubs = vi.hoisted(() => ({
  authorizeUri: vi.fn(
    (state: string) => `https://intuit.example/connect?state=${state}`,
  ),
}));

// The handler reaches for the composition root; give it a real OAuth store
// over an in-memory database and a stub Intuit client, so the assertions can
// be about the gate rather than about wiring.
vi.mock("../../deps.js", async () => {
  const { openDatabase } = await import("../../store/db.js");
  const { OAuthStore } = await import("../oauth-store.js");
  return {
    oauthStore: new OAuthStore(openDatabase(":memory:")),
    intuitOAuth: { authorizeUri: stubs.authorizeUri },
  };
});

const { oauthStore } = await import("../../deps.js");
const { googleCallbackHandler } = await import("../google-callback.js");

/** What the injected verifier returns, or throws, for the next call. */
let googleResult: GoogleIdentity | Error = {
  email: "kim@aircfo.com",
  emailVerified: true,
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.get(
    "/oauth/google/callback",
    googleCallbackHandler(async () => {
      if (googleResult instanceof Error) throw googleResult;
      return googleResult;
    }),
  );
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/oauth/google/callback`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  googleResult = { email: "kim@aircfo.com", emailVerified: true };
  stubs.authorizeUri.mockClear();
});

/** A parked authorization, as `provider.authorize` would have created. */
function parkAuthorization(): string {
  return oauthStore.createPendingAuth({
    clientId: "test-client",
    redirectUri: "http://localhost:3118/callback",
    codeChallenge: "challenge",
    scopes: [],
    mcpState: "mcp-state",
  });
}

async function callback(params: {
  state?: string;
  code?: string;
}): Promise<{ status: number; location: string | null; body: string }> {
  const query = new URLSearchParams();
  if (params.state) query.set("state", params.state);
  if (params.code) query.set("code", params.code);
  const res = await fetch(`${baseUrl}?${query.toString()}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    body: await res.text(),
  };
}

describe("the Google identity gate", () => {
  it("sends an allowed teammate on to Intuit under a fresh state", async () => {
    const googleState = parkAuthorization();
    const reply = await callback({ state: googleState, code: "google-code" });

    expect(reply.status).toBe(302);
    expect(reply.location).toContain("https://intuit.example/connect?state=");

    // The state handed to Intuit must not be the one Google just used: each is
    // single-use, so reusing it would make the Google leg replayable.
    const intuitState = stubs.authorizeUri.mock.calls[0]?.[0];
    expect(intuitState).toBeTruthy();
    expect(intuitState).not.toBe(googleState);
  });

  it("carries the verified identity forward to the Intuit leg", async () => {
    const reply = await callback({
      state: parkAuthorization(),
      code: "google-code",
    });
    expect(reply.status).toBe(302);

    const intuitState = stubs.authorizeUri.mock.calls[0]?.[0] as string;
    const pending = oauthStore.consumePendingAuth(intuitState);
    expect(pending?.email).toBe("kim@aircfo.com");
    expect(pending?.emailVerified).toBe(true);
    // And the original request's details survive the hop.
    expect(pending?.clientId).toBe("test-client");
    expect(pending?.mcpState).toBe("mcp-state");
    expect(pending?.codeChallenge).toBe("challenge");
  });

  it("stops an address outside the domain before it reaches Intuit", async () => {
    googleResult = { email: "aarondras@gmail.com", emailVerified: true };
    const reply = await callback({
      state: parkAuthorization(),
      code: "google-code",
    });

    expect(reply.status).toBe(403);
    expect(reply.body).toContain("aarondras@gmail.com");
    expect(stubs.authorizeUri).not.toHaveBeenCalled();
  });

  it("stops an address Google did not verify", async () => {
    googleResult = { email: "kim@aircfo.com", emailVerified: false };
    const reply = await callback({
      state: parkAuthorization(),
      code: "google-code",
    });

    expect(reply.status).toBe(403);
    expect(stubs.authorizeUri).not.toHaveBeenCalled();
  });

  it("refuses a state it has never seen", async () => {
    const reply = await callback({ state: "not-a-state", code: "google-code" });
    expect(reply.status).toBe(400);
    expect(stubs.authorizeUri).not.toHaveBeenCalled();
  });

  it("refuses a replay of a state it already consumed", async () => {
    const state = parkAuthorization();
    expect((await callback({ state, code: "google-code" })).status).toBe(302);
    expect((await callback({ state, code: "google-code" })).status).toBe(400);
  });

  it("refuses a callback with no code", async () => {
    const reply = await callback({ state: parkAuthorization() });
    expect(reply.status).toBe(400);
    expect(stubs.authorizeUri).not.toHaveBeenCalled();
  });

  it("reports a verification failure without reaching Intuit", async () => {
    googleResult = new Error("Google returned no id_token");
    const reply = await callback({
      state: parkAuthorization(),
      code: "google-code",
    });

    expect(reply.status).toBe(502);
    expect(stubs.authorizeUri).not.toHaveBeenCalled();
  });
});
