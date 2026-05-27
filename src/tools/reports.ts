import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { definedOnly, promisify } from "./_format.js";
import { runQbo } from "./_shared.js";

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

/**
 * Read-only financial reports (Batch A). Each tool forwards typed params to the
 * QBO Reports API and returns the structured report JSON. Bound to one
 * connection via the closure on `connectionId`.
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
      },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportProfitAndLoss(definedOnly(args), cb)),
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
      },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportBalanceSheet(definedOnly(args), cb)),
      ),
  );

  server.registerTool(
    "get_cash_flow",
    {
      description:
        "Statement of Cash Flows for a period: operating, investing, and financing activities, plus net change in cash.",
      inputSchema: { ...dateRange, summarize_column_by: summarizeBy },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportCashFlow(definedOnly(args), cb)),
      ),
  );

  server.registerTool(
    "get_trial_balance",
    {
      description:
        "Trial Balance: the debit and credit balance of every account as of the period end. Use to confirm the books balance or as the basis for adjusting entries.",
      inputSchema: { ...dateRange, accounting_method: accountingMethod },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportTrialBalance(definedOnly(args), cb)),
      ),
  );

  server.registerTool(
    "get_general_ledger",
    {
      description:
        "General Ledger detail: every transaction line posted to each account in the period. The drill-down behind the trial balance and financial statements.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        account: z
          .string()
          .optional()
          .describe("Limit to a specific account by QBO id."),
        source_account: z
          .string()
          .optional()
          .describe("Filter by source account type."),
        sort_by: z
          .string()
          .optional()
          .describe("Column to sort by, e.g. 'txn_date'."),
      },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportGeneralLedgerDetail(definedOnly(args), cb)),
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
      },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportAgedReceivables(definedOnly(args), cb)),
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
      },
    },
    async (args) =>
      runQbo(connectionId, (qb) =>
        promisify((cb) => qb.reportAgedPayables(definedOnly(args), cb)),
      ),
  );
}
