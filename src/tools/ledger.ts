import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type QuickBooks from "node-quickbooks";
import { promisify } from "./_format.js";
import {
  buildCriteria,
  extractList,
  searchInput,
  slimEntity,
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
    async (args: SearchArgs) =>
      runQbo(connectionId, async (qb) => {
        const res = await promisify((cb) =>
          spec.finder(qb, buildCriteria(args), cb),
        );
        const results = extractList(res, spec.queryKey).map(slimEntity);
        return { count: results.length, results };
      }),
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
    finder: (qb, c, cb) => qb.findAccounts(c, cb),
    getter: (qb, id, cb) => qb.getAccount(id, cb),
    searchDescription:
      "Search the chart of accounts. Filterable fields: Name, AccountType, AccountSubType, Classification, Active, CurrentBalance. Use to find account ids for the general ledger or to review the COA.",
    getDescription:
      "Fetch one account from the chart of accounts by its QBO id.",
  },
  {
    searchName: "search_journal_entries",
    getName: "get_journal_entry",
    queryKey: "JournalEntry",
    finder: (qb, c, cb) => qb.findJournalEntries(c, cb),
    getter: (qb, id, cb) => qb.getJournalEntry(id, cb),
    searchDescription:
      "Search journal entries. Filterable fields: TxnDate, DocNumber, Adjust, PrivateNote. Each result includes the JE header and its debit/credit lines.",
    getDescription: "Fetch one journal entry (header + lines) by its QBO id.",
  },
  {
    searchName: "search_invoices",
    getName: "get_invoice",
    queryKey: "Invoice",
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
    finder: (qb, c, cb) => qb.findItems(c, cb),
    getter: (qb, id, cb) => qb.getItem(id, cb),
    searchDescription:
      "Search products/services (items). Filterable fields: Name, Type (Inventory/NonInventory/Service), Active, UnitPrice.",
    getDescription: "Fetch one product/service item by its QBO id.",
  },
  {
    searchName: "search_payments",
    getName: "get_payment",
    queryKey: "Payment",
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
