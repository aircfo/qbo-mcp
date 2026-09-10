import { randomBytes } from "node:crypto";
import type DatabaseType from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionStore } from "../connection-store.js";
import { TokenCipher } from "../crypto.js";
import { openDatabase } from "../db.js";

describe("ConnectionStore", () => {
  let db: DatabaseType.Database;
  let store: ConnectionStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new ConnectionStore(
      db,
      new TokenCipher(randomBytes(32).toString("base64")),
    );
  });

  afterEach(() => {
    db.close();
  });

  const sample = {
    realmId: "123456789",
    companyName: "Acme Co",
    accessToken: "access-abc",
    accessExpiresAt: Date.now() + 3_600_000,
    refreshToken: "refresh-xyz",
  };

  it("creates a connection and reads it back with plaintext tokens", () => {
    const id = store.create(sample);
    const conn = store.get(id);
    expect(conn).not.toBeNull();
    expect(conn?.realmId).toBe("123456789");
    expect(conn?.accessToken).toBe("access-abc");
    expect(conn?.refreshToken).toBe("refresh-xyz");
  });

  it("stores tokens encrypted at rest, not in plaintext", () => {
    const id = store.create(sample);
    const row = db
      .prepare(
        "SELECT access_token_enc, refresh_token_enc FROM connections WHERE id = ?",
      )
      .get(id) as {
      access_token_enc: string;
      refresh_token_enc: string;
    };
    expect(row.access_token_enc).not.toContain("access-abc");
    expect(row.refresh_token_enc).not.toContain("refresh-xyz");
  });

  it("updates the token pair on refresh", () => {
    const id = store.create(sample);
    const newExpiry = Date.now() + 7_200_000;
    store.updateTokens(id, {
      accessToken: "access-new",
      accessExpiresAt: newExpiry,
      refreshToken: "refresh-rotated",
    });
    const conn = store.get(id);
    expect(conn?.accessToken).toBe("access-new");
    expect(conn?.refreshToken).toBe("refresh-rotated");
    expect(conn?.accessExpiresAt).toBe(newExpiry);
  });

  it("returns null for an unknown id", () => {
    expect(store.get("does-not-exist")).toBeNull();
  });

  it("throws when updating tokens for a missing connection", () => {
    expect(() =>
      store.updateTokens("missing", {
        accessToken: "a",
        accessExpiresAt: 1,
        refreshToken: "r",
      }),
    ).toThrow();
  });

  it("deletes a connection", () => {
    const id = store.create(sample);
    store.delete(id);
    expect(store.get(id)).toBeNull();
  });

  describe("findByRealmAndEmail", () => {
    it("finds the connection for one person and one company", () => {
      const id = store.create({ ...sample, email: "kim@aircfo.com" });
      expect(store.findByRealmAndEmail("123456789", "kim@aircfo.com")?.id).toBe(
        id,
      );
    });

    it("returns the newest row when a pair has several", () => {
      // The live table already looks like this: one person accumulated
      // thirteen rows for one company before re-authorization folded them in.
      const older = store.create({ ...sample, email: "kim@aircfo.com" });
      const newer = store.create({ ...sample, email: "kim@aircfo.com" });
      const found = store.findByRealmAndEmail("123456789", "kim@aircfo.com");
      expect(found?.id).toBe(newer);
      expect(found?.id).not.toBe(older);
    });

    it("does not match another person or another company", () => {
      store.create({ ...sample, email: "kim@aircfo.com" });
      expect(
        store.findByRealmAndEmail("123456789", "someone@else.com"),
      ).toBeNull();
      expect(
        store.findByRealmAndEmail("999999999", "kim@aircfo.com"),
      ).toBeNull();
    });

    it("returns null when the stored connection has no email", () => {
      store.create({ ...sample, email: null });
      expect(store.findByRealmAndEmail("123456789", "kim@aircfo.com")).toBeNull();
    });
  });

  it("caches the company name without disturbing the tokens", () => {
    const id = store.create({ ...sample, companyName: null });
    store.setCompanyName(id, "airCFO");
    const conn = store.get(id);
    expect(conn?.companyName).toBe("airCFO");
    expect(conn?.accessToken).toBe("access-abc");
    expect(conn?.refreshToken).toBe("refresh-xyz");
  });
});
