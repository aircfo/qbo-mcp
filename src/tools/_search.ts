import { z } from "zod";

/**
 * Pure search helpers shared by the ledger read/search tools. No app deps, so
 * unit-testable. Bridges our typed search input to node-quickbooks' criteria
 * format and trims response noise.
 */

const OPERATORS = ["=", "IN", "<", ">", "<=", ">=", "LIKE"] as const;

/**
 * Applied whenever the caller omits `limit`. A search must never be unbounded:
 * node-quickbooks treats no-limit as "return the whole table", which blows the
 * response limit on a real chart of accounts (250+ rows).
 */
export const DEFAULT_LIMIT = 100;

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
  format: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "compact = a few key fields per row, token-cheap (default); full = the full entity. For complete detail on one row, use the matching get_<entity> tool.",
    ),
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
  format?: "compact" | "full";
}

/** Translate our search args into the criteria shape node-quickbooks expects. */
export function buildCriteria(
  args: SearchArgs,
): Array<Record<string, unknown>> {
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
  // Always bound the query. Without a limit, node-quickbooks returns the whole
  // table; this is the server-side guarantee that a search is never unbounded.
  criteria.push({ field: "limit", value: args.limit ?? DEFAULT_LIMIT });
  if (typeof args.offset === "number")
    criteria.push({ field: "offset", value: args.offset });
  return criteria;
}

/** Pull the entity array out of a node-quickbooks `QueryResponse`. */
export function extractList(res: unknown, entityKey: string): unknown[] {
  const queryResponse = (
    res as { QueryResponse?: Record<string, unknown> } | null
  )?.QueryResponse;
  const list = queryResponse?.[entityKey];
  return Array.isArray(list) ? list : [];
}

/**
 * Validate that every filter/sort field is on the entity's allowlist. Returns
 * an error message (listing the allowed fields) or null when all fields pass.
 * Keeps user-supplied field names out of the QBO query unless we expect them.
 */
export function validateFields(
  args: SearchArgs,
  allowed: readonly string[],
): string | null {
  const allowedSet = new Set(allowed);
  const used = [
    ...(args.filters ?? []).map((f) => f.field),
    ...(args.sort_by ? [args.sort_by] : []),
  ];
  const bad = used.filter((field) => !allowedSet.has(field));
  if (bad.length === 0) return null;
  return `Unsupported field(s): ${bad.join(", ")}. Allowed fields: ${allowed.join(", ")}.`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep only the listed fields — a compact "list view" of an entity. A full QBO
 * object carries MetaData, line arrays, addresses, etc. (~500+ chars each);
 * projecting to a handful of key fields keeps a large result set token-cheap.
 * Non-objects pass through untouched.
 */
export function projectEntity(
  entity: unknown,
  fields: readonly string[],
): unknown {
  if (!isRecord(entity)) return entity;
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in entity) projected[field] = entity[field];
  }
  return projected;
}

export interface SearchEnvelope {
  count: number;
  results: unknown[];
  /** Present only when the row cap was hit and more rows may exist. */
  truncated?: true;
  next_offset?: number;
  hint?: string;
}

/**
 * Wrap search rows in a result envelope. QBO applies the limit at the query
 * layer, so we can't know the true total — we infer "there may be more" when
 * the page came back full, and surface a paging hint so the caller can page via
 * `offset` rather than silently missing rows.
 */
export function shapeSearchResults(
  results: unknown[],
  args: SearchArgs,
): SearchEnvelope {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (results.length >= limit) {
    const nextOffset = (args.offset ?? 1) + limit;
    return {
      count: results.length,
      results,
      truncated: true,
      next_offset: nextOffset,
      hint: `More rows may exist. Page with offset=${nextOffset}, raise limit (max 1000), or add a filter to narrow the search.`,
    };
  }
  return { count: results.length, results };
}
