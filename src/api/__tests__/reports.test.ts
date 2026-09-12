import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSummaryRow } from "../../store/connection-store.js";

const getClient = vi.fn();
vi.mock("../../deps.js", () => ({
  clientManager: { getClient: (id: string) => getClient(id) },
  connectionStore: {},
  oauthStore: {},
  intuitOAuth: {},
  oauthProvider: {},
}));

const { serviceApiRouter } = await import("../index.js");
const { ConnectionNotFoundError, ReauthRequiredError } = await import(
  "../../qbo/client-manager.js"
);

const TOKEN = "t".repeat(48);
const NOW = Date.now();
const DAY = 24 * 60 * 60_000;

/** One verified, healthy connection to realm 793988035. */
const ROW: ConnectionSummaryRow = {
  id: "conn-live",
  realm_id: "793988035",
  company_name: "airCFO",
  email: "alex@aircfo.com",
  email_verified: 1,
  writes_enabled: 0,
  created_at: NOW - 30 * DAY,
  refresh_updated_at: NOW - DAY,
};

/**
 * A QuickBooks profit-and-loss as the Reports API really returns it, carrying
 * the trap this endpoint exists to preserve: the Income group lists one child
 * account at 352,109 but its subtotal is 521,873. The missing 169,764 was
 * booked directly to the parent account and appears ONLY in the summary. A
 * pipeline that sums `rows` alone under-reports by that amount, and the
 * numbers still look plausible.
 */
const REPORT = {
  Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Aug 2026" }] },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: "Income" }] },
        Rows: {
          Row: [
            {
              ColData: [
                { value: "41000 Accounting Services" },
                { value: "352109.00" },
              ],
            },
          ],
        },
        Summary: {
          ColData: [{ value: "Total Income" }, { value: "521873.00" }],
        },
      },
    ],
  },
};

let rows: ConnectionSummaryRow[] = [ROW];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(
    "/api",
    serviceApiRouter({
      token: TOKEN,
      principalId: "svc:test",
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  rows = [ROW];
  getClient.mockReset();
  getClient.mockResolvedValue({
    qb: {
      reportProfitAndLoss: (_p: object, cb: (e: unknown, d: unknown) => void) =>
        cb(null, REPORT),
      reportBalanceSheet: (_p: object, cb: (e: unknown, d: unknown) => void) =>
        cb(null, REPORT),
      reportTrialBalance: (_p: object, cb: (e: unknown, d: unknown) => void) =>
        cb(null, REPORT),
      reportGeneralLedgerDetail: (
        _p: object,
        cb: (e: unknown, d: unknown) => void,
      ) => cb(null, REPORT),
    },
    realmId: "793988035",
  });
});

const auth = { authorization: `Bearer ${TOKEN}` };
const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: auth });

describe("GET /api/reports/:report", () => {
  it("returns a shaped report for a connected company", async () => {
    const res = await get(
      "/api/reports/profit-and-loss?realm=793988035&start_date=2026-08-01&end_date=2026-08-31",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      columns: string[];
      rows: string[][];
      totals: string[][];
    };
    expect(body.columns).toContain("Aug 2026");
    expect(body.rows).toHaveLength(1);

    // The point of the three-array shape. The subtotal carries an amount that
    // appears in no row, so a caller summing rows alone under-reports. If this
    // ever collapses to two arrays, a pipeline silently reports less money
    // than the client earned.
    expect(body.totals.length).toBeGreaterThan(0);
    const rowSum = body.rows.reduce((n, r) => n + Number(r[r.length - 1]), 0);
    const reported = Number(body.totals[0]![body.totals[0]!.length - 1]);
    expect(rowSum).toBe(352109);
    expect(reported).toBe(521873);
    expect(reported).toBeGreaterThan(rowSum);
  });

  it.each([
    "profit-and-loss",
    "balance-sheet",
    "trial-balance",
    "general-ledger",
  ])("serves %s", async (slug) => {
    const res = await get(`/api/reports/${slug}?realm=793988035`);
    expect(res.status).toBe(200);
  });

  it("answers 400 for a report that is not on the list", async () => {
    const res = await get("/api/reports/cash-flow?realm=793988035");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_report");
  });

  it("answers 400 for a lone date rather than reporting the wrong period", async () => {
    const res = await get(
      "/api/reports/profit-and-loss?realm=793988035&start_date=2026-08-01",
    );
    expect(res.status).toBe(400);
  });

  it("answers 404 for a company nobody has connected", async () => {
    const res = await get("/api/reports/profit-and-loss?realm=does-not-exist");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_connected");
  });

  it("answers 404 rather than 502 when the row vanishes mid-request", async () => {
    getClient.mockRejectedValue(new ConnectionNotFoundError("conn-live"));
    const res = await get("/api/reports/profit-and-loss?realm=793988035");
    expect(res.status).toBe(404);
  });

  it("answers 409 when the credential has lapsed, so the pipeline stops retrying", async () => {
    getClient.mockRejectedValue(new ReauthRequiredError(new Error("expired")));
    const res = await get("/api/reports/profit-and-loss?realm=793988035");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("reauth_required");
  });

  it("answers 409 without touching QuickBooks when the only connection predates the identity gate", async () => {
    // Every other door refuses a pre-gate row; the machine door must not be
    // the one caller that can still read through it.
    rows = [{ ...ROW, email_verified: 0 }];
    const res = await get("/api/reports/profit-and-loss?realm=793988035");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("reauth_required");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("still tries a verified connection whose refresh is stale, since staleness is only a prediction", async () => {
    rows = [{ ...ROW, refresh_updated_at: NOW - 100 * DAY }];
    const res = await get("/api/reports/profit-and-loss?realm=793988035");
    expect(res.status).toBe(200);
    expect(getClient).toHaveBeenCalledWith("conn-live");
  });

  it("answers 502 when QuickBooks itself fails", async () => {
    getClient.mockResolvedValue({
      qb: {
        reportProfitAndLoss: (
          _p: object,
          cb: (e: unknown, d: unknown) => void,
        ) => cb(new Error("QuickBooks exploded"), null),
      },
      realmId: "793988035",
    });
    const res = await get("/api/reports/profit-and-loss?realm=793988035");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream_failed");
  });

  it("requires the service token like every other route here", async () => {
    const res = await fetch(`${baseUrl}/api/reports/profit-and-loss?realm=793988035`);
    expect(res.status).toBe(401);
  });

  it("resolves the realm to the same connection the listing reports", async () => {
    // Two rows for one company: the listing picks the most recently refreshed
    // verified one, and the report call must use that same connection.
    rows = [
      { ...ROW, id: "conn-older", refresh_updated_at: NOW - 10 * DAY },
      { ...ROW, id: "conn-newer", refresh_updated_at: NOW - 1 },
    ];
    await get("/api/reports/profit-and-loss?realm=793988035");
    expect(getClient).toHaveBeenCalledWith("conn-newer");
  });
});
