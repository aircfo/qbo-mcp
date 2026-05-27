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
});
