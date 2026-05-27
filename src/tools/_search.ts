import { z } from "zod";

/**
 * Pure search helpers shared by the ledger read/search tools. No app deps, so
 * unit-testable. Bridges our typed search input to node-quickbooks' criteria
 * format and trims response noise.
 */

const OPERATORS = ["=", "IN", "<", ">", "<=", ">=", "LIKE"] as const;

/** Reusable input shape for every `search_*` tool (a Zod raw shape). */
export const searchInput = {
  filters: z
    .array(
      z.object({
        field: z
          .string()
          .describe(
            "QBO field name (see this tool's description for filterable fields).",
          ),
        operator: z
          .enum(OPERATORS)
          .optional()
          .describe("Comparison operator; defaults to '='."),
        value: z
          .union([z.string(), z.number(), z.boolean()])
          .describe("Value to compare against."),
      }),
    )
    .optional()
    .describe("Field filters, ANDed together."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max rows to return (default 100)."),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based row offset, for paging."),
  sort_by: z.string().optional().describe("Field to sort by."),
  sort_desc: z
    .boolean()
    .optional()
    .describe("Sort descending (default ascending)."),
};

export interface SearchArgs {
  filters?: {
    field: string;
    operator?: (typeof OPERATORS)[number];
    value: string | number | boolean;
  }[];
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_desc?: boolean;
}

/** Translate our search args into the criteria shape node-quickbooks expects. */
export function buildCriteria(
  args: SearchArgs,
): Array<Record<string, unknown>> | Record<string, never> {
  const criteria: Array<Record<string, unknown>> = [];
  for (const f of args.filters ?? []) {
    criteria.push({
      field: f.field,
      value: f.value,
      operator: f.operator ?? "=",
    });
  }
  if (args.sort_by)
    criteria.push({
      field: args.sort_desc ? "desc" : "asc",
      value: args.sort_by,
    });
  if (typeof args.limit === "number")
    criteria.push({ field: "limit", value: args.limit });
  if (typeof args.offset === "number")
    criteria.push({ field: "offset", value: args.offset });
  // node-quickbooks treats an empty object as "no filter — return all".
  return criteria.length > 0 ? criteria : {};
}

/** Pull the entity array out of a node-quickbooks `QueryResponse`. */
export function extractList(res: unknown, entityKey: string): unknown[] {
  const queryResponse = (
    res as { QueryResponse?: Record<string, unknown> } | null
  )?.QueryResponse;
  const list = queryResponse?.[entityKey];
  return Array.isArray(list) ? list : [];
}

/** Drop the always-present envelope noise QBO stamps on every entity. */
export function slimEntity<T>(entity: T): T {
  if (!entity || typeof entity !== "object") return entity;
  const {
    domain: _domain,
    sparse: _sparse,
    ...rest
  } = entity as Record<string, unknown>;
  return rest as T;
}
