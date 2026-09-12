import { describe, expect, it } from "vitest";
import {
  REPORTS,
  REPORT_SLUGS,
  isReportSlug,
  parseReportQuery,
  type ReportSlug,
} from "../reports-logic.js";

function ok(query: Record<string, unknown>, slug: ReportSlug = "profit-and-loss") {
  const result = parseReportQuery(slug, query);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.request;
}

function err(
  query: Record<string, unknown>,
  slug: ReportSlug = "profit-and-loss",
): string {
  const result = parseReportQuery(slug, query);
  if (result.ok) throw new Error("expected a rejection");
  return result.error;
}

describe("isReportSlug", () => {
  it.each(REPORT_SLUGS)("accepts %s", (slug) => {
    expect(isReportSlug(slug)).toBe(true);
  });

  it("rejects anything not on the list", () => {
    expect(isReportSlug("cash-flow")).toBe(false);
    expect(isReportSlug("../../etc/passwd")).toBe(false);
    expect(isReportSlug("")).toBe(false);
  });
});

describe("parseReportQuery", () => {
  it("requires a realm, since there is no default company", () => {
    expect(err({})).toContain("realm");
  });

  it.each(REPORT_SLUGS)("accepts a bare realm for %s", (slug) => {
    expect(ok({ realm: "r" }, slug).qboParams).toEqual({});
  });

  it("passes the QuickBooks parameters through under their own names", () => {
    const request = ok({
      realm: "793988035",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      accounting_method: "Accrual",
      summarize_column_by: "Month",
    });
    expect(request.realm).toBe("793988035");
    expect(request.qboParams).toEqual({
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      accounting_method: "Accrual",
      summarize_column_by: "Month",
    });
  });

  // The trap that returns a plausible wrong answer instead of an error.
  it("rejects a lone start_date", () => {
    expect(err({ realm: "r", start_date: "2026-08-01" })).toContain("both");
  });

  it("rejects a lone end_date", () => {
    expect(err({ realm: "r", end_date: "2026-08-31" })).toContain("both");
  });

  it("accepts neither date, which reports on the current period", () => {
    expect(ok({ realm: "r" }).qboParams).toEqual({});
  });

  it.each(["2026-8-1", "08/01/2026", "yesterday", "2026-08-01T00:00:00Z"])(
    "rejects %s as a date",
    (value) => {
      expect(err({ realm: "r", start_date: value, end_date: "2026-08-31" })).toContain(
        "YYYY-MM-DD",
      );
    },
  );

  it("rejects an accounting method QuickBooks would answer 400 for", () => {
    expect(err({ realm: "r", accounting_method: "accrual" })).toContain(
      "accounting_method",
    );
  });

  it("defaults the format to compact", () => {
    expect(ok({ realm: "r" }).format).toBe("compact");
  });

  it("honours an explicit raw format", () => {
    expect(ok({ realm: "r", format: "raw" }).format).toBe("raw");
  });

  it("rejects an unknown format", () => {
    expect(err({ realm: "r", format: "csv" })).toContain("format");
  });

  it.each(["0", "-1", "2.5", "abc", "999999"])(
    "rejects max_rows of %s",
    (value) => {
      expect(err({ realm: "r", max_rows: value })).toContain("max_rows");
    },
  );

  it("accepts a sensible max_rows as a number", () => {
    expect(ok({ realm: "r", max_rows: "500" }).maxRows).toBe(500);
  });

  it("leaves max_rows unset when it is not given", () => {
    expect(ok({ realm: "r" }).maxRows).toBeUndefined();
  });

  it("takes the first value when a parameter is repeated", () => {
    // Express hands a repeated query parameter over as an array; letting one
    // through would reach Intuit as "[object Object]".
    const request = ok({ realm: ["793988035", "other"] });
    expect(request.realm).toBe("793988035");
  });

  it("ignores an empty parameter rather than forwarding it", () => {
    expect(ok({ realm: "r", summarize_column_by: "" }).qboParams).toEqual({});
  });
});

describe("what each report accepts", () => {
  // QuickBooks silently ignores a parameter a report does not take, which
  // would hand an unattended caller a plausible wrong answer. So the door
  // refuses instead, and these tests pin which parameters each report takes.

  it("takes an as-of report_date for the aging reports and forwards it", () => {
    for (const slug of ["aged-receivables", "aged-payables"] as const) {
      expect(ok({ realm: "r", report_date: "2026-08-31" }, slug).qboParams).toEqual({
        report_date: "2026-08-31",
      });
    }
  });

  it("rejects a date range on an aging report, which is a snapshot not a period", () => {
    const message = err(
      { realm: "r", start_date: "2026-08-01", end_date: "2026-08-31" },
      "aged-receivables",
    );
    expect(message).toContain("start_date");
    expect(message).toContain("aged-receivables");
  });

  it("rejects an accounting method on an aging report", () => {
    expect(
      err({ realm: "r", accounting_method: "Accrual" }, "aged-payables"),
    ).toContain("accounting_method");
  });

  it("rejects report_date on a period report", () => {
    expect(err({ realm: "r", report_date: "2026-08-31" })).toContain("report_date");
  });

  it("rejects a malformed report_date", () => {
    expect(err({ realm: "r", report_date: "Aug 31" }, "aged-receivables")).toContain(
      "YYYY-MM-DD",
    );
  });

  it("rejects an accounting method or period columns on the transaction list", () => {
    expect(
      err({ realm: "r", accounting_method: "Cash" }, "transaction-list"),
    ).toContain("accounting_method");
    expect(
      err({ realm: "r", summarize_column_by: "Month" }, "transaction-list"),
    ).toContain("summarize_column_by");
  });

  it("takes a date range on the transaction list", () => {
    expect(
      ok({ realm: "r", start_date: "2026-08-01", end_date: "2026-08-31" }, "transaction-list")
        .qboParams,
    ).toEqual({ start_date: "2026-08-01", end_date: "2026-08-31" });
  });

  it("takes the same parameters for sales by customer as for the P&L", () => {
    expect(REPORTS["sales-by-customer"].params).toEqual(REPORTS["profit-and-loss"].params);
  });

  it("rejects a parameter this door has never heard of, rather than dropping it", () => {
    expect(err({ realm: "r", customer: "42" })).toContain("customer");
  });

  it("still ignores an empty value for a parameter the report does not take", () => {
    expect(ok({ realm: "r", accounting_method: "" }, "transaction-list").qboParams).toEqual({});
  });

  it("marks the two transaction-level reports as detail, so they carry the default row cap", () => {
    const detail = REPORT_SLUGS.filter((slug) => REPORTS[slug].detail);
    expect(detail.sort()).toEqual(["general-ledger", "transaction-list"]);
  });
});
