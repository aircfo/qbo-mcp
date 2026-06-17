import { describe, expect, it } from "vitest";
import {
  definedOnly,
  flattenReport,
  json,
  promisify,
  shapeReport,
  toolError,
} from "../_format.js";

// A General Ledger-shaped report: account sections, each with leaf transaction
// rows, a section Summary, and column MetaData scaffolding to flatten away.
const glReport = {
  Header: { ReportName: "GeneralLedger", StartPeriod: "2026-03-01" },
  Columns: {
    Column: [
      { ColTitle: "Date", ColType: "Date", MetaData: [{ Name: "ID" }] },
      { ColTitle: "Transaction Type", ColType: "String" },
      { ColTitle: "Name", ColType: "String" },
      { ColTitle: "Amount", ColType: "Money" },
      { ColTitle: "Balance", ColType: "Money" },
    ],
  },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: "Checking", id: "35" }, { value: "" }] },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [
                { value: "2026-03-02" },
                { value: "Bill Payment" },
                { value: "Eight Point Compass", id: "12" },
                { value: "-2000.00" },
                { value: "8000.00" },
              ],
            },
            {
              type: "Data",
              ColData: [
                { value: "2026-03-15" },
                { value: "Expense" },
                { value: "Apple", id: "7" },
                { value: "-500.00" },
                { value: "7500.00" },
              ],
            },
          ],
        },
        Summary: { ColData: [{ value: "Total for Checking" }, { value: "" }] },
        type: "Section",
      },
      {
        Header: {
          ColData: [{ value: "Office Expense", id: "60" }, { value: "" }],
        },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [
                { value: "2026-03-15" },
                { value: "Expense" },
                { value: "Apple", id: "7" },
                { value: "500.00" },
                { value: "500.00" },
              ],
            },
          ],
        },
        Summary: { ColData: [{ value: "Total for Office Expense" }] },
        type: "Section",
      },
    ],
  },
};

// A Profit & Loss-shaped report: nested sections, a blank-titled label column,
// and the parent-with-direct-posting case that exposed the fidelity bug — the
// $40,160 booked directly to "63000 Practice Development" exists ONLY in that
// section's Summary (45,160 total vs the single 5,000 child leaf), never as a
// leaf row. "Net Income" is a QBO-tagged computed line (group attribute).
const plReport = {
  Header: { ReportName: "ProfitAndLoss" },
  Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Total" }] },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: "Income" }, { value: "" }] },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [{ value: "Sales", id: "1" }, { value: "10000.00" }],
            },
          ],
        },
        Summary: {
          ColData: [{ value: "Total Income" }, { value: "10000.00" }],
        },
        type: "Section",
      },
      {
        Header: {
          ColData: [{ value: "63000 Practice Development" }, { value: "" }],
        },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [
                { value: "63100 Conferences", id: "3" },
                { value: "5000.00" },
              ],
            },
          ],
        },
        Summary: {
          ColData: [
            { value: "Total 63000 Practice Development" },
            { value: "45160.00" },
          ],
        },
        type: "Section",
      },
      {
        type: "Data",
        group: "NetIncome",
        ColData: [{ value: "Net Income" }, { value: "-35160.00" }],
      },
    ],
  },
};

describe("definedOnly", () => {
  it("drops undefined keys but keeps falsy-but-defined values", () => {
    expect(definedOnly({ a: 1, b: undefined, c: 0, d: "", e: false })).toEqual({
      a: 1,
      c: 0,
      d: "",
      e: false,
    });
  });

  it("returns an empty object when everything is undefined", () => {
    expect(definedOnly({ a: undefined, b: undefined })).toEqual({});
  });
});

describe("json", () => {
  it("wraps a payload as compact JSON text content", () => {
    const result = json({ a: 1 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "text", text: '{"a":1}' });
  });
});

describe("toolError", () => {
  it("marks the result as an error", () => {
    const result = toolError("boom");
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: "text", text: "boom" });
  });
});

describe("promisify", () => {
  it("resolves with the callback's data", async () => {
    await expect(promisify<number>((cb) => cb(null, 42))).resolves.toBe(42);
  });

  it("rejects when the callback yields an error", async () => {
    await expect(
      promisify((cb) => cb(new Error("nope"), null)),
    ).rejects.toThrow("nope");
  });
});

describe("flattenReport", () => {
  it("emits one leaf-data row per transaction, with no summaries in rows", () => {
    // 2 leaves under Checking + 1 under Office Expense = 3.
    expect(flattenReport(glReport).rows).toHaveLength(3);
    // P&L leaves: Sales + 63100 Conferences = 2 (Net Income is a total).
    expect(flattenReport(plReport).rows).toHaveLength(2);
  });

  it("returns array rows aligned to a single columns header", () => {
    const { columns, rows } = flattenReport(glReport);
    expect(columns).toEqual([
      "group",
      "Date",
      "Transaction Type",
      "Name",
      "Amount",
      "Balance",
    ]);
    expect(rows[0]).toEqual([
      "Checking",
      "2026-03-02",
      "Bill Payment",
      "Eight Point Compass",
      "-2000.00",
      "8000.00",
    ]);
    // Every row carries its account section as the leading "group" element.
    expect(rows.map((row) => row[0])).toEqual([
      "Checking",
      "Checking",
      "Office Expense",
    ]);
  });

  it("carries the nearest section header onto nested leaves", () => {
    const groups = flattenReport(plReport).rows.map((row) => row[0]);
    expect(groups).toEqual(["Income", "63000 Practice Development"]);
  });

  it("falls back to a stable key for blank-titled columns", () => {
    const flat = flattenReport(plReport);
    expect(flat.columns).toEqual(["group", "col0", "Total"]);
    expect(flat.rows[0]).toEqual(["Income", "Sales", "10000.00"]);
  });

  it("preserves subtotals in totals, including parent-direct postings", () => {
    const { totals } = flattenReport(plReport);
    // The $40,160 booked directly to the parent survives only via this
    // subtotal (45,160 total vs the 5,000 child leaf). Dropping it was the bug.
    expect(totals).toContainEqual([
      "63000 Practice Development",
      "Total 63000 Practice Development",
      "45160.00",
    ]);
    // QBO-tagged computed lines land in totals, not rows.
    expect(totals).toContainEqual(["NetIncome", "Net Income", "-35160.00"]);
  });

  it("keeps section subtotals out of the summable rows array", () => {
    const { rows, totals } = flattenReport(glReport);
    expect(rows.flat()).not.toContain("Total for Checking");
    expect(totals.map((total) => total[1])).toEqual([
      "Total for Checking",
      "Total for Office Expense",
    ]);
  });

  it("drops MetaData/ColType/id scaffolding from the output", () => {
    const serialized = JSON.stringify(flattenReport(glReport));
    expect(serialized).not.toContain("MetaData");
    expect(serialized).not.toContain("ColType");
    expect(serialized).not.toContain("ColData");
  });

  it("is materially smaller than the raw report", () => {
    const compact = JSON.stringify(flattenReport(glReport));
    const raw = JSON.stringify(glReport);
    expect(compact.length).toBeLessThan(raw.length);
  });

  it("returns an empty result for missing or malformed input", () => {
    const empty = { columns: ["group"], rows: [], totals: [] };
    expect(flattenReport(undefined)).toEqual(empty);
    expect(flattenReport({})).toEqual(empty);
  });
});

describe("shapeReport", () => {
  it("passes the raw report through untouched when format is raw", () => {
    expect(shapeReport(glReport, { format: "raw" })).toBe(glReport);
  });

  it("flattens by default", () => {
    expect(shapeReport(glReport)).toEqual(flattenReport(glReport));
  });

  it("caps rows but keeps totals when rows exceed maxRows", () => {
    const shaped = shapeReport(glReport, { maxRows: 2 }) as {
      rows: unknown[];
      totals: unknown[];
      truncated: boolean;
      returned: number;
      hint: string;
    };
    expect(shaped.rows).toHaveLength(2);
    expect(shaped.totals).toHaveLength(2);
    expect(shaped.truncated).toBe(true);
    expect(shaped.returned).toBe(2);
    expect(shaped.hint).toContain("get_expenses_by_vendor");
  });

  it("does not add a truncation envelope when under the cap", () => {
    expect(shapeReport(glReport, { maxRows: 100 })).not.toHaveProperty(
      "truncated",
    );
  });
});
