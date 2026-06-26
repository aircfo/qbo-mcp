import { describe, expect, it } from "vitest";
import {
  buildCriteria,
  DEFAULT_LIMIT,
  extractList,
  projectEntity,
  shapeSearchResults,
  slimEntity,
  validateFields,
} from "../_search.js";

describe("buildCriteria", () => {
  it("applies the default limit when there are no args (never unbounded)", () => {
    expect(buildCriteria({})).toEqual([
      { field: "limit", value: DEFAULT_LIMIT },
    ]);
  });

  it("maps filters to field/value/operator, defaulting the operator to '='", () => {
    expect(
      buildCriteria({
        filters: [
          { field: "Balance", operator: ">", value: 0 },
          { field: "Active", value: true },
        ],
      }),
    ).toEqual([
      { field: "Balance", value: 0, operator: ">" },
      { field: "Active", value: true, operator: "=" },
      { field: "limit", value: DEFAULT_LIMIT },
    ]);
  });

  it("encodes sort + paging as node-quickbooks pseudo-fields", () => {
    expect(
      buildCriteria({
        sort_by: "TxnDate",
        sort_desc: true,
        limit: 50,
        offset: 10,
      }),
    ).toEqual([
      { field: "desc", value: "TxnDate" },
      { field: "limit", value: 50 },
      { field: "offset", value: 10 },
    ]);
  });

  it("uses 'asc' when sort_desc is not set, still bounded by the default limit", () => {
    expect(buildCriteria({ sort_by: "Name" })).toEqual([
      { field: "asc", value: "Name" },
      { field: "limit", value: DEFAULT_LIMIT },
    ]);
  });
});

describe("projectEntity", () => {
  it("keeps only the listed fields", () => {
    const account = {
      Id: "33",
      Name: "Checking",
      AccountType: "Bank",
      MetaData: { CreateTime: "2020-01-01" },
      CurrencyRef: { value: "USD" },
    };
    expect(projectEntity(account, ["Id", "Name", "AccountType"])).toEqual({
      Id: "33",
      Name: "Checking",
      AccountType: "Bank",
    });
  });

  it("omits listed fields that are absent rather than emitting undefined", () => {
    expect(projectEntity({ Id: "1" }, ["Id", "AcctNum"])).toEqual({ Id: "1" });
  });

  it("passes through non-objects unchanged", () => {
    expect(projectEntity(null, ["Id"])).toBeNull();
  });
});

describe("shapeSearchResults", () => {
  it("returns a plain count/results envelope when under the limit", () => {
    const rows = [{ Id: "1" }, { Id: "2" }];
    expect(shapeSearchResults(rows, { limit: 10 })).toEqual({
      count: 2,
      results: rows,
    });
  });

  it("flags truncation and a next_offset when the page comes back full", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ Id: String(i) }));
    const env = shapeSearchResults(rows, { limit: 5 });
    expect(env.truncated).toBe(true);
    expect(env.next_offset).toBe(6);
    expect(env.hint).toContain("offset=6");
  });

  it("advances next_offset from the current offset", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ Id: String(i) }));
    expect(shapeSearchResults(rows, { limit: 5, offset: 11 }).next_offset).toBe(
      16,
    );
  });

  it("uses the default limit to detect truncation when none is passed", () => {
    const rows = Array.from({ length: DEFAULT_LIMIT }, (_, i) => ({
      Id: String(i),
    }));
    expect(shapeSearchResults(rows, {}).truncated).toBe(true);
  });
});

describe("extractList", () => {
  it("pulls the entity array out of a QueryResponse", () => {
    const res = { QueryResponse: { Invoice: [{ Id: "1" }, { Id: "2" }] } };
    expect(extractList(res, "Invoice")).toHaveLength(2);
  });

  it("returns an empty array when the key or QueryResponse is absent", () => {
    expect(extractList({ QueryResponse: {} }, "Invoice")).toEqual([]);
    expect(extractList(null, "Invoice")).toEqual([]);
  });
});

describe("slimEntity", () => {
  it("drops domain and sparse but keeps real fields", () => {
    expect(
      slimEntity({ Id: "1", domain: "QBO", sparse: false, Name: "Cash" }),
    ).toEqual({
      Id: "1",
      Name: "Cash",
    });
  });

  it("passes through non-objects unchanged", () => {
    expect(slimEntity(null)).toBeNull();
  });
});

describe("validateFields", () => {
  const allowed = ["Id", "TxnDate", "TotalAmt"] as const;

  it("returns null when all filter/sort fields are allowed", () => {
    expect(
      validateFields(
        {
          filters: [{ field: "TxnDate", value: "2026-01-01" }],
          sort_by: "TotalAmt",
        },
        allowed,
      ),
    ).toBeNull();
  });

  it("returns null when there are no fields at all", () => {
    expect(validateFields({}, allowed)).toBeNull();
  });

  it("flags a disallowed filter field and lists the allowed ones", () => {
    const msg = validateFields(
      { filters: [{ field: "DROP TABLE", value: 1 }] },
      allowed,
    );
    expect(msg).toContain("DROP TABLE");
    expect(msg).toContain("Id, TxnDate, TotalAmt");
  });

  it("flags a disallowed sort field", () => {
    expect(validateFields({ sort_by: "Secret" }, allowed)).toContain("Secret");
  });
});
