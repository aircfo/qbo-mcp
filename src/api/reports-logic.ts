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
  "aged-receivables",
  "aged-payables",
  "sales-by-customer",
  "transaction-list",
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORT_SLUGS as readonly string[]).includes(value);
}

/**
 * The QuickBooks parameters this door understands. Every report also takes
 * `realm`, `format` and `max_rows`, which are this server's, not QuickBooks'.
 */
export type ReportParam =
  | "start_date"
  | "end_date"
  | "report_date"
  | "accounting_method"
  | "summarize_column_by";

const REPORT_PARAMS: readonly ReportParam[] = [
  "start_date",
  "end_date",
  "report_date",
  "accounting_method",
  "summarize_column_by",
];

const OWN_PARAMS = ["realm", "format", "max_rows"] as const;

export interface ReportSpec {
  /**
   * Which parameters QuickBooks honours for this report, per Intuit's own
   * parameter models. QuickBooks silently ignores the rest, which would turn a
   * caller's mistake into a plausible wrong answer, so a parameter that is not
   * listed here is refused rather than forwarded.
   */
  params: readonly ReportParam[];
  /**
   * A detail report lists transactions rather than balances, so an unfiltered
   * month can be enormous and it carries the default row cap.
   */
  detail: boolean;
}

const PERIOD_STATEMENT: readonly ReportParam[] = [
  "start_date",
  "end_date",
  "accounting_method",
  "summarize_column_by",
];

export const REPORTS: Record<ReportSlug, ReportSpec> = {
  "profit-and-loss": { params: PERIOD_STATEMENT, detail: false },
  "balance-sheet": { params: PERIOD_STATEMENT, detail: false },
  "trial-balance": { params: PERIOD_STATEMENT, detail: false },
  "general-ledger": { params: PERIOD_STATEMENT, detail: true },
  "sales-by-customer": { params: PERIOD_STATEMENT, detail: false },
  // Aging is a snapshot as of one date rather than a period, and Intuit's
  // aging models take no accounting method.
  "aged-receivables": { params: ["report_date"], detail: false },
  "aged-payables": { params: ["report_date"], detail: false },
  // A list of transactions, not a statement: no accounting method and no
  // period columns.
  "transaction-list": { params: ["start_date", "end_date"], detail: true },
};

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

function isReportParam(name: string): name is ReportParam {
  return (REPORT_PARAMS as readonly string[]).includes(name);
}

/**
 * Validate a report request's query string against what that report accepts.
 *
 * Pure, so every rejection is testable without a server. The vocabulary is
 * deliberately the same as the Claude tools use, so there is one set of
 * parameter names across both doors rather than two to keep in step.
 */
export function parseReportQuery(
  slug: ReportSlug,
  query: Record<string, unknown>,
): ParseResult {
  const realm = firstString(query.realm);
  if (!realm) return { ok: false, error: "realm is required" };

  // An unattended caller cannot notice a parameter being dropped, so nothing
  // is dropped: a name this door does not know, or one this report does not
  // take, is an error the pipeline will see.
  const accepted = REPORTS[slug].params;
  for (const name of Object.keys(query)) {
    if (firstString(query[name]) === undefined) continue;
    if ((OWN_PARAMS as readonly string[]).includes(name)) continue;
    if (!isReportParam(name)) {
      return { ok: false, error: `${name} is not a parameter of this door` };
    }
    if (!accepted.includes(name)) {
      return {
        ok: false,
        error: `${name} does not apply to ${slug}; it takes ${accepted.join(", ")}`,
      };
    }
  }

  const startDate = firstString(query.start_date);
  const endDate = firstString(query.end_date);
  const reportDate = firstString(query.report_date);
  for (const [name, value] of [
    ["start_date", startDate],
    ["end_date", endDate],
    ["report_date", reportDate],
  ] as const) {
    if (value !== undefined && !DATE_PATTERN.test(value)) {
      return { ok: false, error: `${name} must be YYYY-MM-DD` };
    }
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
  if (reportDate) qboParams.report_date = reportDate;
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
