import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Pure tool-result + param helpers. Deliberately free of any app dependencies
 * (no deps.ts, no env) so they're trivially unit-testable.
 */

/** Compact JSON (no pretty-print) to keep large QBO payloads token-cheap. */
export function json(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Promisify a node-quickbooks callback method. */
export function promisify<T>(
  run: (cb: (err: unknown, data: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** Drop undefined keys so optional, unset params aren't forwarded to QBO. */
export function definedOnly<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export interface FlatReport {
  /** Column keys each row/total array is aligned to (leading key is "group"). */
  columns: string[];
  /** Leaf data rows (transactions or leaf accounts), safe to list or sum. */
  rows: string[][];
  /**
   * Subtotal rows (section totals, Gross Profit, Net Income, ...). Kept
   * separate because they are NOT summable with `rows` — and because an amount
   * posted directly to a parent account lives only here, never as a leaf row.
   */
  totals: string[][];
}

// QBO report JSON is deeply nested and untyped third-party data, so narrowing
// from `unknown` is genuinely required here. The casts are confined to these
// two guards rather than scattered through the walk.
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read a report cell's display value (`{ value, id? }`), as a string. */
function cellValue(cell: unknown): string {
  const value = asRecord(cell)?.value;
  if (typeof value === "string") return value;
  return value == null ? "" : String(value);
}

/** Column titles from `Columns.Column[].ColTitle`, made unique and non-empty. */
function reportColumns(report: Record<string, unknown> | undefined): string[] {
  const columns = asRecord(report?.Columns)?.Column;
  if (!Array.isArray(columns)) return [];
  const seen = new Map<string, number>();
  return columns.map((column, index) => {
    const raw = asRecord(column)?.ColTitle;
    const base =
      typeof raw === "string" && raw.trim() ? raw.trim() : `col${index}`;
    const priorCount = seen.get(base) ?? 0;
    seen.set(base, priorCount + 1);
    return priorCount === 0 ? base : `${base}_${index}`;
  });
}

/** Build one `[group, ...cells]` array aligned to `colCount` QBO columns. */
function buildRow(
  group: string,
  colData: unknown[],
  colCount: number,
): string[] {
  const cells = [group];
  for (let index = 0; index < colCount; index += 1) {
    cells.push(cellValue(colData[index]));
  }
  return cells;
}

/**
 * Recurse the report's row tree. Section rows ({ Header, Rows }) carry their
 * header label down to descendants as `group`; leaf data rows go to `rows`.
 * Section `Summary` rows and QBO-tagged computed lines (Gross Profit, Net
 * Income) go to `totals` — dropping them was losing amounts booked directly to
 * a parent account, since those exist only in the parent's subtotal.
 */
function flattenRows(
  rowNodes: unknown,
  colCount: number,
  group: string,
  rows: string[][],
  totals: string[][],
): void {
  if (!Array.isArray(rowNodes)) return;
  for (const node of rowNodes) {
    const row = asRecord(node);
    if (!row) continue;

    const nested = asRecord(row.Rows)?.Row;
    if (Array.isArray(nested)) {
      const header = asRecord(row.Header)?.ColData;
      const label = Array.isArray(header) ? cellValue(header[0]).trim() : "";
      const childGroup = label || group;
      flattenRows(nested, colCount, childGroup, rows, totals);
      const summary = asRecord(row.Summary)?.ColData;
      if (Array.isArray(summary)) {
        totals.push(buildRow(childGroup, summary, colCount));
      }
      continue;
    }

    const colData = row.ColData;
    if (Array.isArray(colData)) {
      const computed = typeof row.group === "string" ? row.group.trim() : "";
      if (computed) {
        totals.push(buildRow(computed, colData, colCount));
      } else {
        rows.push(buildRow(group, colData, colCount));
      }
    }
  }
}

/**
 * Flatten a QBO report (Header + Columns + nested Rows) into compact tabular
 * arrays, dropping MetaData/ColType/id wrappers. Rows are arrays aligned to a
 * single `columns` header (no per-row key repetition), and subtotals are kept
 * in `totals` so the result stays lossless.
 */
export function flattenReport(report: unknown): FlatReport {
  const root = asRecord(report);
  const columns = reportColumns(root);
  const rows: string[][] = [];
  const totals: string[][] = [];
  flattenRows(asRecord(root?.Rows)?.Row, columns.length, "", rows, totals);
  return { columns: ["group", ...columns], rows, totals };
}

/**
 * Shape a report for return: `raw` passes the QBO JSON through untouched;
 * otherwise flatten to compact arrays and apply an optional cap on `rows`,
 * returning a truncation envelope (totals are kept) when the cap is hit.
 */
export function shapeReport(
  report: unknown,
  opts: { format?: "compact" | "raw"; maxRows?: number } = {},
): unknown {
  if (opts.format === "raw") return report;
  const { columns, rows, totals } = flattenReport(report);
  if (typeof opts.maxRows === "number" && rows.length > opts.maxRows) {
    return {
      columns,
      rows: rows.slice(0, opts.maxRows),
      totals,
      truncated: true,
      returned: opts.maxRows,
      hint: "Result truncated. Narrow the date range, add a filter/columns, or use get_expenses_by_vendor for vendor totals.",
    };
  }
  return { columns, rows, totals };
}
