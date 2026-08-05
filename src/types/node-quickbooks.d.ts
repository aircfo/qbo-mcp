declare module "node-quickbooks" {
  type QboCallback = (err: unknown, data: unknown) => void;

  export default class QuickBooks {
    constructor(
      consumerKey: string,
      consumerSecret: string,
      accessToken: string,
      tokenSecret: boolean | string,
      realmId: string,
      useSandbox?: boolean,
      debug?: boolean,
      minorversion?: string | number | null,
      oauthVersion?: string,
      refreshToken?: string,
    );

    // Company
    getCompanyInfo(id: string, callback: QboCallback): void;

    // Reports (pass-through param objects per QBO Reports API)
    reportProfitAndLoss(options: object, callback: QboCallback): void;
    reportBalanceSheet(options: object, callback: QboCallback): void;
    reportCashFlow(options: object, callback: QboCallback): void;
    reportTrialBalance(options: object, callback: QboCallback): void;
    reportGeneralLedgerDetail(options: object, callback: QboCallback): void;
    reportAgedReceivables(options: object, callback: QboCallback): void;
    reportAgedPayables(options: object, callback: QboCallback): void;
    reportProfitAndLossDetail(options: object, callback: QboCallback): void;
    reportVendorExpenses(options: object, callback: QboCallback): void;
    reportVendorBalance(options: object, callback: QboCallback): void;
    reportVendorBalanceDetail(options: object, callback: QboCallback): void;
    reportTransactionListByVendor(options: object, callback: QboCallback): void;
    reportAgedReceivableDetail(options: object, callback: QboCallback): void;
    reportAgedPayableDetail(options: object, callback: QboCallback): void;
    reportCustomerSales(options: object, callback: QboCallback): void;
    reportItemSales(options: object, callback: QboCallback): void;
    reportClassSales(options: object, callback: QboCallback): void;
    reportCustomerBalance(options: object, callback: QboCallback): void;
    reportCustomerBalanceDetail(options: object, callback: QboCallback): void;
    reportTransactionList(options: object, callback: QboCallback): void;
    reportTransactionListByCustomer(
      options: object,
      callback: QboCallback,
    ): void;

    // Ledger read/search (Batch B). find* take a criteria object/array and
    // return { QueryResponse: { <Entity>: [...] } }; get* take an id.
    findAccounts(criteria: object, callback: QboCallback): void;
    getAccount(id: string, callback: QboCallback): void;
    findJournalEntries(criteria: object, callback: QboCallback): void;
    getJournalEntry(id: string, callback: QboCallback): void;
    findInvoices(criteria: object, callback: QboCallback): void;
    getInvoice(id: string, callback: QboCallback): void;
    findBills(criteria: object, callback: QboCallback): void;
    getBill(id: string, callback: QboCallback): void;
    findVendors(criteria: object, callback: QboCallback): void;
    getVendor(id: string, callback: QboCallback): void;
    findCustomers(criteria: object, callback: QboCallback): void;
    getCustomer(id: string, callback: QboCallback): void;
    findItems(criteria: object, callback: QboCallback): void;
    getItem(id: string, callback: QboCallback): void;
    findPayments(criteria: object, callback: QboCallback): void;
    getPayment(id: string, callback: QboCallback): void;
    findClasses(criteria: object, callback: QboCallback): void;
    getClass(id: string, callback: QboCallback): void;
  }
}
