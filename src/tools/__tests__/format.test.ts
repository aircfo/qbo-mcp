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

// A Profit & Loss-shaped report: nested sections, a blank-titled label column.
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
        Header: { ColData: [{ value: "Expenses" }, { value: "" }] },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [{ value: "Rent", id: "2" }, { value: "3000.00" }],
            },
            {
              type: "Data",
              ColData: [{ value: "Payroll", id: "3" }, { value: "5000.00" }],
            },
          ],
        },
        type: "Section",
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
  it("emits one row per leaf ColData and no section/summary rows", () => {
    // 2 leaves under Checking + 1 under Office Expense = 3.
    expect(flattenReport(glReport).rows).toHaveLength(3);
    // P&L: Sales + Rent + Payroll = 3 leaves across two sections.
    expect(flattenReport(plReport).rows).toHaveLength(3);
  });

  it("keys each row by column title and carries the section header as group", () => {
    const { columns, rows } = flattenReport(glReport);
    expect(columns).toEqual([
      "group",
      "Date",
      "Transaction Type",
      "Name",
      "Amount",
      "Balance",
    ]);
    expect(rows[0]).toEqual({
      group: "Checking",
      Date: "2026-03-02",
      "Transaction Type": "Bill Payment",
      Name: "Eight Point Compass",
      Amount: "-2000.00",
      Balance: "8000.00",
    });
    // The last leaf belongs to a different account section.
    expect(rows[2].group).toBe("Office Expense");
  });

  it("carries the nearest section header onto nested leaves", () => {
    const groups = flattenReport(plReport).rows.map((r) => r.group);
    expect(groups).toEqual(["Income", "Expenses", "Expenses"]);
  });

  it("falls back to a stable key for blank-titled columns", () => {
    // P&L's first (label) column has no ColTitle, so it becomes col0.
    expect(flattenReport(plReport).rows[0]).toEqual({
      group: "Income",
      col0: "Sales",
      Total: "10000.00",
    });
  });

  it("drops MetaData/ColType/id scaffolding from every row", () => {
    const serialized = JSON.stringify(flattenReport(glReport).rows);
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
    expect(flattenReport(undefined)).toEqual({ columns: ["group"], rows: [] });
    expect(flattenReport({})).toEqual({ columns: ["group"], rows: [] });
  });
});

describe("shapeReport", () => {
  it("passes the raw report through untouched when format is raw", () => {
    expect(shapeReport(glReport, { format: "raw" })).toBe(glReport);
  });

  it("flattens by default", () => {
    const shaped = shapeReport(glReport);
    expect(shaped).toEqual(flattenReport(glReport));
  });

  it("truncates with an envelope when rows exceed maxRows", () => {
    const shaped = shapeReport(glReport, { maxRows: 2 }) as {
      rows: unknown[];
      truncated: boolean;
      returned: number;
      hint: string;
    };
    expect(shaped.rows).toHaveLength(2);
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
