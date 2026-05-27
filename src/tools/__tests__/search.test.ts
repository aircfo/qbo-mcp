import { describe, expect, it } from "vitest";
import {
  buildCriteria,
  extractList,
  slimEntity,
  validateFields,
} from "../_search.js";

describe("buildCriteria", () => {
  it("returns an empty object when there are no args (fetch all)", () => {
    expect(buildCriteria({})).toEqual({});
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

  it("uses 'asc' when sort_desc is not set", () => {
    expect(buildCriteria({ sort_by: "Name" })).toEqual([
      { field: "asc", value: "Name" },
    ]);
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
