import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type QuickBooks from "node-quickbooks";
import { definedOnly, promisify, shapeReport } from "./_format.js";
import { runQbo } from "./_shared.js";

type QboCb = (err: unknown, data: unknown) => void;
type ReportCaller = (qb: QuickBooks, params: object, cb: QboCb) => void;

/** Default row cap for detail reports, so an unfiltered pull degrades gracefully. */
const DEFAULT_MAX_ROWS = 5000;

// Shared parameter fragments (QBO Reports API names, passed through verbatim).
const dateRange = {
  start_date: z
    .string()
    .optional()
    .describe("Start of the reporting period, YYYY-MM-DD."),
  end_date: z
    .string()
    .optional()
    .describe("End of the reporting period, YYYY-MM-DD."),
};
const accountingMethod = z
  .enum(["Cash", "Accrual"])
  .optional()
  .describe(
    "Cash or Accrual basis. Omit to use the company's default report basis.",
  );
const summarizeBy = z
  .enum(["Total", "Days", "Week", "Month", "Quarter", "Year"])
  .optional()
  .describe(
    "Split the report into columns by this period (e.g. Month for a monthly trend).",
  );
const formatParam = z
  .enum(["compact", "raw"])
  .optional()
  .describe(
    "compact = flattened rows, token-cheap (default); raw = full QBO report JSON.",
  );
const maxRowsParam = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    `Cap on returned rows in compact mode (default ${DEFAULT_MAX_ROWS}). When exceeded, rows are truncated and a hint is returned.`,
  );

/**
 * Run a report call against the connection's QBO client and shape the result.
 * Control params (`format`, `max_rows`) are stripped before forwarding so they
 * never leak into the QBO query string; everything else passes through.
 */
function runReport(
  connectionId: string,
  args: Record<string, unknown>,
  caller: ReportCaller,
  defaultMaxRows?: number,
): Promise<CallToolResult> {
  const { format, max_rows, ...qboParams } = args;
  const maxRows = typeof max_rows === "number" ? max_rows : defaultMaxRows;
  return runQbo(connectionId, async (qb) =>
    shapeReport(
      await promisify((cb) => caller(qb, definedOnly(qboParams), cb)),
      { format: format === "raw" ? "raw" : "compact", maxRows },
    ),
  );
}

/**
 * Read-only financial reports. Each tool forwards typed params to the QBO
 * Reports API and returns the report shaped to compact rows (or raw JSON on
 * request). Bound to one connection via the closure on `connectionId`.
 */
export function registerReportTools(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    "get_profit_and_loss",
    {
      description:
        "Profit & Loss (income statement) for a period: income, COGS, expenses, and net income. Optionally filter by customer/vendor/item/department/class, and split into columns by period.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        summarize_column_by: summarizeBy,
        customer: z
          .string()
          .optional()
          .describe("Filter to a customer by QBO id."),
        vendor: z.string().optional().describe("Filter to a vendor by QBO id."),
        item: z
          .string()
          .optional()
          .describe("Filter to a product/service by QBO id."),
        department: z
          .string()
          .optional()
          .describe("Filter to a department/location by QBO id."),
        class: z.string().optional().describe("Filter to a class by QBO id."),
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportProfitAndLoss(p, cb),
      ),
  );

  server.registerTool(
    "get_profit_and_loss_detail",
    {
      description:
        "Profit & Loss Detail: every transaction line behind each P&L account, not just the totals. Use when you need the postings that make up income or an expense line. Optionally filter by customer/vendor and split into columns by period.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        summarize_column_by: summarizeBy,
        customer: z
          .string()
          .optional()
          .describe("Filter to a customer by QBO id."),
        vendor: z.string().optional().describe("Filter to a vendor by QBO id."),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportProfitAndLossDetail(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_balance_sheet",
    {
      description:
        "Balance Sheet as of the end of the period: assets, liabilities, and equity. A point-in-time snapshot.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        summarize_column_by: summarizeBy,
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportBalanceSheet(p, cb),
      ),
  );

  server.registerTool(
    "get_cash_flow",
    {
      description:
        "Statement of Cash Flows for a period: operating, investing, and financing activities, plus net change in cash.",
      inputSchema: {
        ...dateRange,
        summarize_column_by: summarizeBy,
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) => qb.reportCashFlow(p, cb)),
  );

  server.registerTool(
    "get_trial_balance",
    {
      description:
        "Trial Balance: the debit and credit balance of every account as of the period end. Use to confirm the books balance or as the basis for adjusting entries.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportTrialBalance(p, cb),
      ),
  );

  server.registerTool(
    "get_general_ledger",
    {
      description:
        "General Ledger detail: every transaction line posted to each account in the period. The drill-down behind the trial balance and financial statements. " +
        "Filter by account/vendor/customer/account_type and use columns to return only the fields you need. For ranking vendors by spend, prefer get_expenses_by_vendor.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        summarize_column_by: summarizeBy,
        account: z
          .string()
          .optional()
          .describe("Limit to a specific account by QBO id."),
        source_account: z
          .string()
          .optional()
          .describe("Filter by source account type."),
        vendor: z
          .string()
          .optional()
          .describe("Filter GL to one vendor by QBO id."),
        customer: z
          .string()
          .optional()
          .describe("Filter GL to one customer by QBO id."),
        account_type: z
          .string()
          .optional()
          .describe(
            "Filter to accounts of this type, e.g. 'Expense' or 'CostOfGoodsSold'.",
          ),
        columns: z
          .string()
          .optional()
          .describe(
            "Comma-separated columns to return, e.g. 'tx_date,vend_name,account_name,subt_nat_amount'. Fewer columns = smaller payload.",
          ),
        sort_by: z
          .string()
          .optional()
          .describe("Column to sort by, e.g. 'txn_date'."),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportGeneralLedgerDetail(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_expenses_by_vendor",
    {
      description:
        "Expenses by Vendor Summary: total spend grouped by vendor for the period. " +
        "Use summarize_column_by: Month for a per-month breakout (e.g. top vendors by " +
        "month). The direct way to rank vendors by spend — prefer this over the general " +
        "ledger for vendor-spend questions.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        summarize_column_by: summarizeBy,
        vendor: z
          .string()
          .optional()
          .describe("Filter to one vendor by QBO id."),
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportVendorExpenses(p, cb),
      ),
  );

  server.registerTool(
    "get_vendor_balance",
    {
      description:
        "Vendor Balance Summary: the open balance owed to each vendor as of the period end. Use to see who you owe across all vendors at a glance.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        vendor: z
          .string()
          .optional()
          .describe("Filter to one vendor by QBO id."),
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportVendorBalance(p, cb),
      ),
  );

  server.registerTool(
    "get_vendor_balance_detail",
    {
      description:
        "Vendor Balance Detail: the individual open bills and payments behind each vendor's balance. The drill-down for what makes up an amount owed to a vendor.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        vendor: z
          .string()
          .optional()
          .describe("Filter to one vendor by QBO id."),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportVendorBalanceDetail(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_transactions_by_vendor",
    {
      description:
        "Transaction List by Vendor: every transaction (bills, payments, expenses) grouped by vendor for the period. Use for a line-level audit of activity with a vendor.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        vendor: z
          .string()
          .optional()
          .describe("Filter to one vendor by QBO id."),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportTransactionListByVendor(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_aged_receivables",
    {
      description:
        "A/R Aging Summary: outstanding customer balances bucketed by age (current, 1-30, 31-60, 61-90, 90+). Shows who owes you and how overdue.",
      inputSchema: {
        report_date: z
          .string()
          .optional()
          .describe("As-of date, YYYY-MM-DD. Defaults to today."),
        customer: z
          .string()
          .optional()
          .describe("Limit to one customer by QBO id."),
        aging_method: z
          .enum(["Current", "Report_Date"])
          .optional()
          .describe("Age relative to today (Current) or to the report date."),
        days_per_aging_period: z
          .number()
          .int()
          .optional()
          .describe("Bucket width in days (default 30)."),
        num_periods: z
          .number()
          .int()
          .optional()
          .describe("Number of aging buckets (default 4)."),
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportAgedReceivables(p, cb),
      ),
  );

  server.registerTool(
    "get_aged_payables",
    {
      description:
        "A/P Aging Summary: outstanding vendor bills bucketed by age. Shows what you owe and how overdue.",
      inputSchema: {
        report_date: z
          .string()
          .optional()
          .describe("As-of date, YYYY-MM-DD. Defaults to today."),
        vendor: z
          .string()
          .optional()
          .describe("Limit to one vendor by QBO id."),
        aging_method: z
          .enum(["Current", "Report_Date"])
          .optional()
          .describe("Age relative to today (Current) or to the report date."),
        days_per_aging_period: z
          .number()
          .int()
          .optional()
          .describe("Bucket width in days (default 30)."),
        num_periods: z
          .number()
          .int()
          .optional()
          .describe("Number of aging buckets (default 4)."),
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportAgedPayables(p, cb),
      ),
  );
}
