import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type QuickBooks from "node-quickbooks";
import {
  definedOnly,
  promisify,
  requireBothDates,
  shapeReport,
} from "./_format.js";
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
    .describe(
      "Start of the reporting period, YYYY-MM-DD. Pass both dates or neither: QuickBooks ignores a lone date and reports on the current period instead.",
    ),
  end_date: z
    .string()
    .optional()
    .describe(
      "End of the reporting period, YYYY-MM-DD. Pass both dates or neither — for a point-in-time balance sheet, pass the first day of the period as start_date and the as-of date as end_date.",
    ),
};

/**
 * QBO's account-type vocabulary, exactly as the Reports API spells it: no
 * spaces, CamelCase. An unrecognised spelling is answered with HTTP 400 by
 * Intuit, so the values are an enum here and a caller sees the list instead.
 */
const ACCOUNT_TYPES = [
  "Bank",
  "AccountsReceivable",
  "OtherCurrentAsset",
  "FixedAsset",
  "OtherAsset",
  "AccountsPayable",
  "CreditCard",
  "OtherCurrentLiability",
  "LongTermLiability",
  "Equity",
  "Income",
  "CostOfGoodsSold",
  "Expense",
  "OtherIncome",
  "OtherExpense",
] as const;

const accountingMethod = z
  .enum(["Cash", "Accrual"])
  .optional()
  .describe(
    "Cash or Accrual basis. Omit to use the company's default report basis.",
  );
const summarizeBy = z
  .enum([
    "Total",
    "Days",
    "Week",
    "Month",
    "Quarter",
    "Year",
    "Customers",
    "Vendors",
    "Classes",
    "Departments",
    "Employees",
    "ProductsAndServices",
  ])
  .optional()
  .describe(
    "Split the report into columns by this period or dimension (e.g. Month for a monthly trend, Classes for a per-class breakout).",
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

// Aging-detail params shared by the A/R and A/P detail reports. QBO's detail
// reports name the bucket width `aging_period` (the summaries use a different
// param set), so that name is kept verbatim here.
const agingDetail = {
  report_date: z
    .string()
    .optional()
    .describe("As-of date, YYYY-MM-DD. Defaults to today."),
  num_periods: z
    .number()
    .int()
    .optional()
    .describe("Number of aging buckets (default 4)."),
  aging_period: z
    .number()
    .optional()
    .describe("Bucket width in days (default 30)."),
  past_due: z
    .number()
    .int()
    .optional()
    .describe("Only rows at least this many days past due."),
  start_duedate: z
    .string()
    .optional()
    .describe("Only rows due on/after this date, YYYY-MM-DD."),
  end_duedate: z
    .string()
    .optional()
    .describe("Only rows due on/before this date, YYYY-MM-DD."),
  columns: z
    .string()
    .optional()
    .describe(
      "Comma-separated columns to return (e.g. 'tx_date,txn_type,doc_num,due_date,memo'). Fewer columns = smaller payload.",
    ),
};

// Sales summary reports (by customer / product / class) share one param set.
const salesSummary = {
  ...dateRange,
  accounting_method: accountingMethod,
  summarize_column_by: summarizeBy,
  customer: z
    .string()
    .optional()
    .describe("Filter to a customer by QBO id (comma-separated for several)."),
  item: z
    .string()
    .optional()
    .describe(
      "Filter to a product/service by QBO id (comma-separated for several).",
    ),
  class: z
    .string()
    .optional()
    .describe("Filter to a class by QBO id (comma-separated for several)."),
  department: z
    .string()
    .optional()
    .describe(
      "Filter to a department/location by QBO id (comma-separated for several).",
    ),
  format: formatParam,
};

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
  // Every report funnels through here, so the half-a-date-range guard is a
  // server guarantee rather than something each tool has to remember.
  const dateError = requireBothDates(args);
  if (dateError) return Promise.resolve(dateError);

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
        "Profit & Loss Detail: every transaction line behind each P&L account, not just the totals. Use when you need the postings that make up income or an expense line. Optionally filter by customer/vendor. For a monthly trend use get_profit_and_loss (a summary report); QBO does not split detail reports into period columns.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
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
        "A full unfiltered month is large and may exceed the inline limit — narrow it with a tight date range, an account_type/account/vendor/customer filter, or a columns projection (e.g. columns='tx_date,vend_name,account_name,subt_nat_amount'). For ranking vendors by spend, use get_expenses_by_vendor instead (it returns inline). " +
        "The GL returns one period column — for a monthly trend use get_profit_and_loss or get_expenses_by_vendor, or derive the month from each row's Date.",
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
        vendor: z
          .string()
          .optional()
          .describe("Filter GL to one vendor by QBO id."),
        customer: z
          .string()
          .optional()
          .describe("Filter GL to one customer by QBO id."),
        account_type: z
          .enum(ACCOUNT_TYPES)
          .optional()
          .describe(
            "Filter to accounts of this type. One call per type is the standard way to sweep a full ledger.",
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
        "A/R Aging Summary: outstanding customer balances bucketed by age (current, 1-30, 31-60, 61-90, 90+). Shows who owes you and how overdue. Use get_aged_receivables_detail for the individual invoices behind each bucket.",
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
        "A/P Aging Summary: outstanding vendor bills bucketed by age. Shows what you owe and how overdue. Use get_aged_payables_detail for the individual bills behind each bucket.",
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

  server.registerTool(
    "get_aged_receivables_detail",
    {
      description:
        "A/R Aging Detail: every open invoice with its customer, due date, age bucket, and open balance. The invoice-level drill-down behind the A/R aging summary — use for collections lists like 'which invoices are 60+ days past due'.",
      inputSchema: {
        ...agingDetail,
        aging_method: z
          .enum(["Current", "Report_Date"])
          .optional()
          .describe("Age relative to today (Current) or to the report date."),
        customer: z
          .string()
          .optional()
          .describe(
            "Limit to a customer by QBO id (comma-separated for several).",
          ),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportAgedReceivableDetail(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_aged_payables_detail",
    {
      description:
        "A/P Aging Detail: every open bill with its vendor, due date, age bucket, and open balance. The bill-level drill-down behind the A/P aging summary — use to build a payment run or see exactly which bills are overdue.",
      inputSchema: {
        ...agingDetail,
        accounting_method: accountingMethod,
        vendor: z
          .string()
          .optional()
          .describe(
            "Limit to a vendor by QBO id (comma-separated for several).",
          ),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportAgedPayableDetail(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_sales_by_customer",
    {
      description:
        "Sales by Customer Summary: total sales grouped by customer for the period. Use summarize_column_by: Month for a per-month breakout (e.g. top customers by month). The direct way to rank customers by revenue.",
      inputSchema: salesSummary,
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportCustomerSales(p, cb),
      ),
  );

  server.registerTool(
    "get_sales_by_product",
    {
      description:
        "Sales by Product/Service Summary: quantity and amount sold per product/service item for the period. This item-level view exists only on sales lines — it cannot be derived from the general ledger.",
      inputSchema: salesSummary,
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) => qb.reportItemSales(p, cb)),
  );

  server.registerTool(
    "get_sales_by_class",
    {
      description:
        "Sales by Class Summary: total sales grouped by class for the period. Only meaningful when the company tracks classes — use search_classes to find class ids or check whether any exist.",
      inputSchema: salesSummary,
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) => qb.reportClassSales(p, cb)),
  );

  server.registerTool(
    "get_customer_balance",
    {
      description:
        "Customer Balance Summary: the open A/R balance per customer as of the report date. Use to see who owes you across all customers at a glance; the customer-side mirror of get_vendor_balance.",
      inputSchema: {
        report_date: z
          .string()
          .optional()
          .describe("As-of date, YYYY-MM-DD. Defaults to today."),
        accounting_method: accountingMethod,
        arpaid: z
          .enum(["All", "Paid", "Unpaid"])
          .optional()
          .describe(
            "Include all, only paid, or only unpaid A/R (default Unpaid).",
          ),
        customer: z
          .string()
          .optional()
          .describe(
            "Filter to a customer by QBO id (comma-separated for several).",
          ),
        department: z
          .string()
          .optional()
          .describe("Filter to a department/location by QBO id."),
        format: formatParam,
      },
    },
    async (args) =>
      runReport(connectionId, args, (qb, p, cb) =>
        qb.reportCustomerBalance(p, cb),
      ),
  );

  server.registerTool(
    "get_customer_balance_detail",
    {
      description:
        "Customer Balance Detail: the individual open invoices and credits behind each customer's balance. The drill-down for what makes up an amount a customer owes.",
      inputSchema: {
        report_date: z
          .string()
          .optional()
          .describe("As-of date, YYYY-MM-DD. Defaults to today."),
        arpaid: z
          .enum(["All", "Paid", "Unpaid"])
          .optional()
          .describe(
            "Include all, only paid, or only unpaid A/R (default Unpaid).",
          ),
        aging_method: z
          .enum(["Current", "Report_Date"])
          .optional()
          .describe("Age relative to today (Current) or to the report date."),
        start_duedate: z
          .string()
          .optional()
          .describe("Only rows due on/after this date, YYYY-MM-DD."),
        end_duedate: z
          .string()
          .optional()
          .describe("Only rows due on/before this date, YYYY-MM-DD."),
        customer: z
          .string()
          .optional()
          .describe(
            "Filter to a customer by QBO id (comma-separated for several).",
          ),
        department: z
          .string()
          .optional()
          .describe("Filter to a department/location by QBO id."),
        columns: z
          .string()
          .optional()
          .describe(
            "Comma-separated columns to return (e.g. 'tx_date,txn_type,doc_num,due_date'). Fewer columns = smaller payload.",
          ),
        sort_by: z.string().optional().describe("Column to sort by."),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportCustomerBalanceDetail(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_transactions_by_customer",
    {
      description:
        "Transaction List by Customer: every transaction (invoices, payments, credit memos) grouped by customer for the period. Use for a line-level audit of activity with a customer; the customer-side mirror of get_transactions_by_vendor.",
      inputSchema: {
        ...dateRange,
        accounting_method: accountingMethod,
        customer: z
          .string()
          .optional()
          .describe("Filter to one customer by QBO id."),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportTransactionListByCustomer(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );

  server.registerTool(
    "get_transaction_list",
    {
      description:
        "Transaction List: one row per transaction for the period, filterable by transaction_type — the only report that surfaces types with no dedicated tool (checks, credit card charges, deposits, transfers, sales receipts, credit memos, estimates, purchase orders). Use for 'show me all deposits in March' or to find a transaction by exact amount (bothamount).",
      inputSchema: {
        ...dateRange,
        transaction_type: z
          .enum([
            "CreditCardCharge",
            "Check",
            "Invoice",
            "ReceivePayment",
            "JournalEntry",
            "Bill",
            "CreditCardCredit",
            "VendorCredit",
            "Credit",
            "BillPaymentCheck",
            "BillPaymentCreditCard",
            "Charge",
            "Transfer",
            "Deposit",
            "Statement",
            "BillableCharge",
            "TimeActivity",
            "CashPurchase",
            "SalesReceipt",
            "CreditMemo",
            "CreditRefund",
            "Estimate",
            "InventoryQuantityAdjustment",
            "PurchaseOrder",
          ])
          .optional()
          .describe("Limit to one transaction type."),
        customer: z
          .string()
          .optional()
          .describe("Filter to a customer by QBO id."),
        vendor: z.string().optional().describe("Filter to a vendor by QBO id."),
        department: z
          .string()
          .optional()
          .describe("Filter to a department/location by QBO id."),
        source_account_type: z
          .string()
          .optional()
          .describe(
            "Filter by source account type, e.g. 'Bank', 'CreditCard', 'AccountsReceivable', 'Expense'.",
          ),
        arpaid: z
          .enum(["All", "Paid", "Unpaid"])
          .optional()
          .describe("A/R paid status (default All)."),
        appaid: z
          .enum(["All", "Paid", "Unpaid"])
          .optional()
          .describe("A/P paid status (default All)."),
        cleared: z
          .enum(["Cleared", "Uncleared", "Reconciled", "Deposited"])
          .optional()
          .describe(
            "Bank-clearing status. 'Uncleared' with an `account` filter and a date range is the uncleared-items list for a reconciliation — QuickBooks exposes no reconciliation report through its API, so this is the closest thing to one.",
          ),
        docnum: z
          .string()
          .optional()
          .describe("Filter by document/reference number."),
        bothamount: z
          .number()
          .optional()
          .describe("Match transactions of exactly this amount."),
        group_by: z
          .string()
          .optional()
          .describe(
            "Group rows by e.g. 'Name', 'Account', 'Transaction Type', 'Month', or 'None'.",
          ),
        sort_by: z.string().optional().describe("Column to sort by."),
        columns: z
          .string()
          .optional()
          .describe(
            "Comma-separated columns to return (e.g. 'tx_date,txn_type,doc_num,name,account_name'). Fewer columns = smaller payload.",
          ),
        format: formatParam,
        max_rows: maxRowsParam,
      },
    },
    async (args) =>
      runReport(
        connectionId,
        args,
        (qb, p, cb) => qb.reportTransactionList(p, cb),
        DEFAULT_MAX_ROWS,
      ),
  );
}
