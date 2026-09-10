import type DatabaseType from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../store/db.js";
import { OAuthStore } from "../oauth-store.js";

describe("OAuthStore token lifecycle", () => {
  let db: DatabaseType.Database;
  let store: OAuthStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new OAuthStore(db);
  });
  afterEach(() => db.close());

  it("issues an access token that verifies and carries its connection", () => {
    const { accessToken } = store.issueTokens({
      clientId: "c1",
      connectionId: "conn1",
    });
    const verified = store.verifyAccess(accessToken);
    expect(verified?.connectionId).toBe("conn1");
    expect(verified?.clientId).toBe("c1");
  });

  it("rejects an unknown access token", () => {
    expect(store.verifyAccess("not-a-real-token")).toBeNull();
  });

  it("rotateRefresh consumes the old refresh token and issues a new pair", () => {
    const { refreshToken } = store.issueTokens({
      clientId: "c1",
      connectionId: "conn1",
    });
    const rotated = store.rotateRefresh(refreshToken);
    expect(rotated?.connectionId).toBe("conn1");
    // old refresh token is now consumed (single-use)
    expect(store.rotateRefresh(refreshToken)).toBeNull();
  });

  it("revokeConnectionTokens invalidates all of a connection's live tokens", () => {
    const a = store.issueTokens({ clientId: "c1", connectionId: "conn1" });
    const other = store.issueTokens({ clientId: "c1", connectionId: "conn2" });
    store.revokeConnectionTokens("conn1");
    expect(store.verifyAccess(a.accessToken)).toBeNull();
    // a different connection's token is untouched
    expect(store.verifyAccess(other.accessToken)?.connectionId).toBe("conn2");
  });
  describe("pending confirmation", () => {
    it("round-trips what the confirmation page needs", () => {
      const token = store.createPendingConfirm({
        connectionId: "conn-1",
        clientId: "client-1",
        redirectUri: "http://localhost:3118/callback",
        codeChallenge: "challenge",
        mcpState: "mcp-state",
        created: true,
      });
      expect(store.consumePendingConfirm(token)).toEqual({
        connectionId: "conn-1",
        clientId: "client-1",
        redirectUri: "http://localhost:3118/callback",
        codeChallenge: "challenge",
        mcpState: "mcp-state",
        created: true,
      });
    });

    it("remembers that a connection was reused, not created", () => {
      // A cancel must not delete a row this flow only refreshed: it belongs to
      // connections the person already had.
      const token = store.createPendingConfirm({
        connectionId: "conn-2",
        clientId: "client-1",
        redirectUri: "http://localhost:3118/callback",
        codeChallenge: "challenge",
        created: false,
      });
      expect(store.consumePendingConfirm(token)?.created).toBe(false);
    });

    it("is single-use", () => {
      const token = store.createPendingConfirm({
        connectionId: "conn-3",
        clientId: "client-1",
        redirectUri: "http://localhost:3118/callback",
        codeChallenge: "challenge",
        created: true,
      });
      expect(store.consumePendingConfirm(token)).not.toBeNull();
      expect(store.consumePendingConfirm(token)).toBeNull();
    });

    it("rejects an unknown token", () => {
      expect(store.consumePendingConfirm("never-issued")).toBeNull();
    });
  });

  describe("purgeExpired", () => {
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;

    it("takes the expired and leaves the live, by their own lifetimes", () => {
      const now = Date.now();
      const issued = store.issueTokens({
        clientId: "client-1",
        connectionId: "conn-1",
      });
      store.createPendingAuth({
        clientId: "client-1",
        redirectUri: "http://localhost:3118/callback",
        codeChallenge: "challenge",
        scopes: [],
      });

      // Nothing has expired yet.
      expect(store.purgeExpired(0, now)).toBe(0);

      // Twenty minutes on, the ten-minute pending_auth has expired; the
      // hour-long access token and the ninety-day refresh token have not.
      expect(store.purgeExpired(0, now + 20 * MINUTE)).toBe(1);
      expect(store.verifyAccess(issued.accessToken)).not.toBeNull();

      // Two hours on, the access token has expired too.
      expect(store.purgeExpired(0, now + 2 * HOUR)).toBe(1);
      expect(store.verifyAccess(issued.accessToken)).toBeNull();

      // The refresh token outlives both and is still usable.
      expect(store.rotateRefresh(issued.refreshToken)).not.toBeNull();
    });

    it("keeps a recently-expired row through its grace period", () => {
      const now = Date.now();
      store.createPendingAuth({
        clientId: "client-1",
        redirectUri: "http://localhost:3118/callback",
        codeChallenge: "challenge",
        scopes: [],
      });
      // Expired twenty minutes ago, but a week of grace keeps it readable for
      // anyone tracing a connect attempt in the logs.
      expect(store.purgeExpired(7 * 24 * HOUR, now + 20 * MINUTE)).toBe(0);
    });
  });
});
