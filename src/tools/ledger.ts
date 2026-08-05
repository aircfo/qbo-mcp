import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type QuickBooks from "node-quickbooks";
import { promisify, toolError } from "./_format.js";
import {
  buildCriteria,
  extractList,
  projectEntity,
  searchInput,
  shapeSearchResults,
  slimEntity,
  validateFields,
  type SearchArgs,
} from "./_search.js";
import { runQbo } from "./_shared.js";

type QboCb = (err: unknown, data: unknown) => void;

interface EntitySpec {
  /** Tool name for the list/search tool, e.g. "search_invoices". */
  searchName: string;
  /** Tool name for the single-fetch tool, e.g. "get_invoice". */
  getName: string;
  /** The key under `QueryResponse` that holds the rows, e.g. "Invoice". */
  queryKey: string;
  /** Allowlist of fields a caller may filter/sort on. */
  filterFields: readonly string[];
  /** Fields kept in the compact "list view" returned by the search tool. */
  projectionFields: readonly string[];
  finder: (qb: QuickBooks, criteria: object, cb: QboCb) => void;
  getter: (qb: QuickBooks, id: string, cb: QboCb) => void;
  searchDescription: string;
  getDescription: string;
}

function registerEntity(
  server: McpServer,
  connectionId: string,
  spec: EntitySpec,
): void {
  server.registerTool(
    spec.searchName,
    { description: spec.searchDescription, inputSchema: searchInput },
    async (args: SearchArgs) => {
      const fieldError = validateFields(args, spec.filterFields);
      if (fieldError) return toolError(fieldError);
      return runQbo(connectionId, async (qb) => {
        const res = await promisify((cb) =>
          spec.finder(qb, buildCriteria(args), cb),
        );
        const raw = extractList(res, spec.queryKey);
        const results =
          args.format === "full"
            ? raw.map(slimEntity)
            : raw.map((entity) => projectEntity(entity, spec.projectionFields));
        return shapeSearchResults(results, args);
      });
    },
  );

  server.registerTool(
    spec.getName,
    {
      description: spec.getDescription,
      inputSchema: { id: z.string().describe("QBO entity id.") },
    },
    async ({ id }) =>
      runQbo(connectionId, async (qb) =>
        slimEntity(await promisify((cb) => spec.getter(qb, id, cb))),
      ),
  );
}

const ENTITIES: EntitySpec[] = [
  {
    searchName: "search_accounts",
    getName: "get_account",
    queryKey: "Account",
    filterFields: [
      "Id",
      "Name",
      "AccountType",
      "AccountSubType",
      "Classification",
      "Active",
      "CurrentBalance",
    ],
    projectionFields: [
      "Id",
      "Name",
      "AcctNum",
      "AccountType",
      "AccountSubType",
      "Classification",
      "Active",
      "CurrentBalance",
      "ParentRef",
    ],
    finder: (qb, c, cb) => qb.findAccounts(c, cb),
    getter: (qb, id, cb) => qb.getAccount(id, cb),
    searchDescription:
      "Search the chart of accounts. Filterable fields: Name, AccountType, AccountSubType, Classification, Active, CurrentBalance. Use to find account ids for the general ledger or to review the COA. Returns up to 100 compact rows by default; to pull a full chart in one call, pass a higher limit (max 1000). Use get_account for an account's full detail.",
    getDescription:
      "Fetch one account from the chart of accounts by its QBO id.",
  },
  {
    searchName: "search_journal_entries",
    getName: "get_journal_entry",
    queryKey: "JournalEntry",
    filterFields: ["Id", "TxnDate", "DocNumber", "Adjust", "PrivateNote"],
    projectionFields: ["Id", "TxnDate", "DocNumber", "Adjust", "PrivateNote"],
    finder: (qb, c, cb) => qb.findJournalEntries(c, cb),
    getter: (qb, id, cb) => qb.getJournalEntry(id, cb),
    searchDescription:
      "Search journal entries. Filterable fields: TxnDate, DocNumber, Adjust, PrivateNote. Returns compact header rows; use get_journal_entry for an entry's debit/credit lines.",
    getDescription: "Fetch one journal entry (header + lines) by its QBO id.",
  },
  {
    searchName: "search_invoices",
    getName: "get_invoice",
    queryKey: "Invoice",
    filterFields: [
      "Id",
      "DocNumber",
      "TxnDate",
      "DueDate",
      "CustomerRef",
      "Balance",
      "TotalAmt",
    ],
    projectionFields: [
      "Id",
      "DocNumber",
      "TxnDate",
      "DueDate",
      "CustomerRef",
      "Balance",
      "TotalAmt",
    ],
    finder: (qb, c, cb) => qb.findInvoices(c, cb),
    getter: (qb, id, cb) => qb.getInvoice(id, cb),
    searchDescription:
      "Search customer invoices (A/R). Filterable fields: DocNumber, TxnDate, DueDate, CustomerRef, Balance, TotalAmt.",
    getDescription: "Fetch one invoice (header + line items) by its QBO id.",
  },
  {
    searchName: "search_bills",
    getName: "get_bill",
    queryKey: "Bill",
    filterFields: [
      "Id",
      "TxnDate",
      "DueDate",
      "DocNumber",
      "VendorRef",
      "Balance",
      "TotalAmt",
    ],
    projectionFields: [
      "Id",
      "TxnDate",
      "DueDate",
      "DocNumber",
      "VendorRef",
      "Balance",
      "TotalAmt",
    ],
    finder: (qb, c, cb) => qb.findBills(c, cb),
    getter: (qb, id, cb) => qb.getBill(id, cb),
    searchDescription:
      "Search vendor bills (A/P). Filterable fields: TxnDate, DueDate, DocNumber, VendorRef, Balance, TotalAmt.",
    getDescription:
      "Fetch one vendor bill (header + line items) by its QBO id.",
  },
  {
    searchName: "search_vendors",
    getName: "get_vendor",
    queryKey: "Vendor",
    filterFields: ["Id", "DisplayName", "CompanyName", "Active", "Balance"],
    projectionFields: ["Id", "DisplayName", "CompanyName", "Active", "Balance"],
    finder: (qb, c, cb) => qb.findVendors(c, cb),
    getter: (qb, id, cb) => qb.getVendor(id, cb),
    searchDescription:
      "Search vendors. Filterable fields: DisplayName, CompanyName, Active, Balance.",
    getDescription: "Fetch one vendor by its QBO id.",
  },
  {
    searchName: "search_customers",
    getName: "get_customer",
    queryKey: "Customer",
    filterFields: ["Id", "DisplayName", "CompanyName", "Active", "Balance"],
    projectionFields: ["Id", "DisplayName", "CompanyName", "Active", "Balance"],
    finder: (qb, c, cb) => qb.findCustomers(c, cb),
    getter: (qb, id, cb) => qb.getCustomer(id, cb),
    searchDescription:
      "Search customers. Filterable fields: DisplayName, CompanyName, Active, Balance.",
    getDescription: "Fetch one customer by its QBO id.",
  },
  {
    searchName: "search_items",
    getName: "get_item",
    queryKey: "Item",
    filterFields: ["Id", "Name", "Type", "Active", "UnitPrice"],
    projectionFields: ["Id", "Name", "Type", "Active", "UnitPrice"],
    finder: (qb, c, cb) => qb.findItems(c, cb),
    getter: (qb, id, cb) => qb.getItem(id, cb),
    searchDescription:
      "Search products/services (items). Filterable fields: Name, Type (Inventory/NonInventory/Service), Active, UnitPrice.",
    getDescription: "Fetch one product/service item by its QBO id.",
  },
  {
    searchName: "search_classes",
    getName: "get_class",
    queryKey: "Class",
    filterFields: ["Id", "Name", "FullyQualifiedName", "Active"],
    projectionFields: [
      "Id",
      "Name",
      "FullyQualifiedName",
      "SubClass",
      "ParentRef",
      "Active",
    ],
    finder: (qb, c, cb) => qb.findClasses(c, cb),
    getter: (qb, id, cb) => qb.getClass(id, cb),
    searchDescription:
      "Search classes (QBO's transaction tagging dimension). Filterable fields: Name, FullyQualifiedName, Active. Use to find class ids for class filters on reports like get_profit_and_loss and get_sales_by_class. Only useful when the company has class tracking enabled.",
    getDescription: "Fetch one class by its QBO id.",
  },
  {
    searchName: "search_payments",
    getName: "get_payment",
    queryKey: "Payment",
    filterFields: ["Id", "TxnDate", "CustomerRef", "TotalAmt"],
    projectionFields: [
      "Id",
      "TxnDate",
      "CustomerRef",
      "TotalAmt",
      "UnappliedAmt",
    ],
    finder: (qb, c, cb) => qb.findPayments(c, cb),
    getter: (qb, id, cb) => qb.getPayment(id, cb),
    searchDescription:
      "Search received customer payments. Filterable fields: TxnDate, CustomerRef, TotalAmt.",
    getDescription: "Fetch one customer payment by its QBO id.",
  },
];

/**
 * Ledger read/search tools (Batch B): a search + get pair per entity, all
 * read-only. The search input shape and slimming are shared; each entity only
 * differs by which node-quickbooks finder/getter it calls.
 */
export function registerLedgerTools(
  server: McpServer,
  connectionId: string,
): void {
  for (const spec of ENTITIES) registerEntity(server, connectionId, spec);
}
