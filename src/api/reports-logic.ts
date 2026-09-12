import { MAX_ROWS_CEILING } from "../tools/_format.js";

/**
 * The reports a scheduled job may ask for, by URL slug.
 *
 * A fixed list rather than a passthrough: the slug reaches this server from an
 * unattended caller, and an allow-list means a typo is a 400 here instead of a
 * surprising call to Intuit.
 */
export const REPORT_SLUGS = [
  "profit-and-loss",
  "balance-sheet",
  "trial-balance",
  "general-ledger",
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORT_SLUGS as readonly string[]).includes(value);
}

const ACCOUNTING_METHODS = ["Cash", "Accrual"] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRequest {
  realm: string;
  /** QBO Reports API parameters, passed through verbatim. */
  qboParams: Record<string, string>;
  format: "compact" | "raw";
  maxRows: number | undefined;
}

export type ParseResult =
  | { ok: true; request: ReportRequest }
  | { ok: false; error: string };

function firstString(value: unknown): string | undefined {
  // Express gives a repeated query parameter as an array. Take the first
  // rather than letting an array reach Intuit as "[object Object]".
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Validate a report request's query string.
 *
 * Pure, so every rejection is testable without a server. The vocabulary is
 * deliberately the same as the Claude tools use, so there is one set of
 * parameter names across both doors rather than two to keep in step.
 */
export function parseReportQuery(query: Record<string, unknown>): ParseResult {
  const realm = firstString(query.realm);
  if (!realm) return { ok: false, error: "realm is required" };

  const startDate = firstString(query.start_date);
  const endDate = firstString(query.end_date);
  if (startDate !== undefined && !DATE_PATTERN.test(startDate)) {
    return { ok: false, error: "start_date must be YYYY-MM-DD" };
  }
  if (endDate !== undefined && !DATE_PATTERN.test(endDate)) {
    return { ok: false, error: "end_date must be YYYY-MM-DD" };
  }
  // The trap that produces a plausible wrong answer rather than an error:
  // QuickBooks ignores a lone date and reports on the current period instead.
  if ((startDate === undefined) !== (endDate === undefined)) {
    return {
      ok: false,
      error:
        "Pass both start_date and end_date, or neither. QuickBooks ignores a lone date and reports on the current period instead.",
    };
  }

  const accountingMethod = firstString(query.accounting_method);
  if (
    accountingMethod !== undefined &&
    !(ACCOUNTING_METHODS as readonly string[]).includes(accountingMethod)
  ) {
    return {
      ok: false,
      error: `accounting_method must be one of ${ACCOUNTING_METHODS.join(", ")}`,
    };
  }

  const format = firstString(query.format);
  if (format !== undefined && format !== "compact" && format !== "raw") {
    return { ok: false, error: "format must be compact or raw" };
  }

  const rawMaxRows = firstString(query.max_rows);
  let maxRows: number | undefined;
  if (rawMaxRows !== undefined) {
    const parsed = Number(rawMaxRows);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ROWS_CEILING) {
      return {
        ok: false,
        error: `max_rows must be a whole number between 1 and ${MAX_ROWS_CEILING}`,
      };
    }
    maxRows = parsed;
  }

  const qboParams: Record<string, string> = {};
  if (startDate) qboParams.start_date = startDate;
  if (endDate) qboParams.end_date = endDate;
  if (accountingMethod) qboParams.accounting_method = accountingMethod;
  const summarize = firstString(query.summarize_column_by);
  if (summarize) qboParams.summarize_column_by = summarize;

  return {
    ok: true,
    request: {
      realm,
      qboParams,
      format: format === "raw" ? "raw" : "compact",
      maxRows,
    },
  };
}
