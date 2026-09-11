import { describe, expect, it } from "vitest";
import type { Connection } from "../../store/connection-store.js";
import { summarizeConnection } from "../_connection-summary.js";

const CONNECTED_AT = Date.parse("2026-09-04T18:22:45.413Z");
const REFRESHED_AT = Date.parse("2026-09-11T12:54:52.192Z");

function connection(over: Partial<Connection> = {}): Connection {
  return {
    id: "6154d962",
    realmId: "793988035",
    companyName: "airCFO",
    email: "alex@aircfo.com",
    emailVerified: true,
    writesEnabled: false,
    termsAcceptedAt: null,
    accessToken: "unused",
    accessExpiresAt: REFRESHED_AT + 3600_000,
    refreshToken: "unused",
    refreshUpdatedAt: REFRESHED_AT,
    createdAt: CONNECTED_AT,
    updatedAt: REFRESHED_AT,
    ...over,
  };
}

describe("summarizeConnection", () => {
  // These two are the regression. Both fields were hardcoded false, so the
  // tools reported every connection as unverified with writes disabled,
  // whatever the row said.
  it("reports a verified identity as verified", () => {
    const summary = summarizeConnection(
      connection({ emailVerified: true }),
      "production",
    );
    expect(summary.connectedBy.verified).toBe(true);
  });

  it("reports writes as enabled when they are enabled", () => {
    const summary = summarizeConnection(
      connection({ writesEnabled: true }),
      "production",
    );
    expect(summary.writesEnabled).toBe(true);
  });

  it("reports an unverified identity as unverified", () => {
    const summary = summarizeConnection(
      connection({ emailVerified: false }),
      "production",
    );
    expect(summary.connectedBy.verified).toBe(false);
  });

  it("reports writes as disabled when they are disabled", () => {
    const summary = summarizeConnection(
      connection({ writesEnabled: false }),
      "production",
    );
    expect(summary.writesEnabled).toBe(false);
  });

  it("carries the realm, company and authorizing address through", () => {
    const summary = summarizeConnection(connection(), "production");
    expect(summary.realmId).toBe("793988035");
    expect(summary.companyName).toBe("airCFO");
    expect(summary.connectedBy.email).toBe("alex@aircfo.com");
  });

  it("reports the environment it is told, not a guess", () => {
    expect(summarizeConnection(connection(), "sandbox").environment).toBe(
      "sandbox",
    );
    expect(summarizeConnection(connection(), "production").environment).toBe(
      "production",
    );
  });

  it("renders both timestamps as ISO strings", () => {
    const summary = summarizeConnection(connection(), "production");
    expect(summary.connectedAt).toBe("2026-09-04T18:22:45.413Z");
    expect(summary.lastRefreshAt).toBe("2026-09-11T12:54:52.192Z");
  });

  it("tolerates a connection with no company name or address yet", () => {
    const summary = summarizeConnection(
      connection({ companyName: null, email: null }),
      "production",
    );
    expect(summary.companyName).toBeNull();
    expect(summary.connectedBy.email).toBeNull();
  });

  it("never includes a credential", () => {
    const serialized = JSON.stringify(
      summarizeConnection(
        connection({ accessToken: "SECRET-ACCESS", refreshToken: "SECRET-REFRESH" }),
        "production",
      ),
    );
    expect(serialized).not.toContain("SECRET-ACCESS");
    expect(serialized).not.toContain("SECRET-REFRESH");
  });
});
