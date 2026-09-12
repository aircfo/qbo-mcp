import { describe, expect, it } from "vitest";
import type { ConnectionSummaryRow } from "../../store/connection-store.js";
import { STALE_REFRESH_MS, selectConnections } from "../connections-logic.js";

const NOW = Date.parse("2026-09-11T00:00:00.000Z");
const DAY = 24 * 60 * 60_000;

function row(over: Partial<ConnectionSummaryRow> = {}): ConnectionSummaryRow {
  return {
    id: "conn-1",
    realm_id: "realm-1",
    company_name: "airCFO",
    email: "alex@aircfo.com",
    email_verified: 1,
    writes_enabled: 0,
    created_at: NOW - 30 * DAY,
    refresh_updated_at: NOW - DAY,
    ...over,
  };
}

describe("selectConnections", () => {
  it("returns one entry per realm when several people connected the same company", () => {
    const result = selectConnections(
      [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })],
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].realmId).toBe("realm-1");
  });

  it("prefers a verified connection over an unverified one, however recent", () => {
    const result = selectConnections(
      [
        row({ id: "unverified", email_verified: 0, refresh_updated_at: NOW }),
        row({
          id: "verified",
          email_verified: 1,
          refresh_updated_at: NOW - 10 * DAY,
        }),
      ],
      NOW,
    );
    expect(result[0].connectionId).toBe("verified");
  });

  it("takes the most recently refreshed among verified connections", () => {
    const result = selectConnections(
      [
        row({ id: "older", refresh_updated_at: NOW - 5 * DAY }),
        row({ id: "newer", refresh_updated_at: NOW - DAY }),
      ],
      NOW,
    );
    expect(result[0].connectionId).toBe("newer");
  });

  it("keeps realms apart", () => {
    const result = selectConnections(
      [row({ realm_id: "realm-1" }), row({ realm_id: "realm-2" })],
      NOW,
    );
    expect(result.map((entry) => entry.realmId).sort()).toEqual([
      "realm-1",
      "realm-2",
    ]);
  });

  it("reports a realm with only unverified connections rather than hiding it", () => {
    const result = selectConnections([row({ email_verified: 0 })], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "needs_reconnect",
      reason: "unverified",
    });
  });

  it("reports a connection whose refresh is older than the stale threshold", () => {
    const result = selectConnections(
      [row({ refresh_updated_at: NOW - STALE_REFRESH_MS - 1 })],
      NOW,
    );
    expect(result[0]).toMatchObject({
      status: "needs_reconnect",
      reason: "stale",
    });
  });

  it("names the identity gap, not the stale refresh, when a row has both", () => {
    const result = selectConnections(
      [
        row({
          email_verified: 0,
          refresh_updated_at: NOW - STALE_REFRESH_MS - 1,
        }),
      ],
      NOW,
    );
    expect(result[0]).toMatchObject({
      status: "needs_reconnect",
      reason: "unverified",
    });
  });

  it("reports a connection refreshed just inside the threshold as ok", () => {
    const result = selectConnections(
      [row({ refresh_updated_at: NOW - STALE_REFRESH_MS + 1 })],
      NOW,
    );
    expect(result[0].status).toBe("ok");
  });

  it("returns an empty list for an empty table", () => {
    expect(selectConnections([], NOW)).toEqual([]);
  });
});
