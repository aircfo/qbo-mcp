import { describe, expect, it } from "vitest";
import { REPORT_SLUGS, isReportSlug, parseReportQuery } from "../reports-logic.js";

function ok(query: Record<string, unknown>) {
  const result = parseReportQuery(query);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.request;
}

function err(query: Record<string, unknown>): string {
  const result = parseReportQuery(query);
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
