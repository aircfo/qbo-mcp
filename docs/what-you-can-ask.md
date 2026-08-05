---
layout: default
title: What you can ask
nav_order: 3
---

# What you can ask

Once your QuickBooks is connected, you talk to Claude the way you'd talk to a
sharp analyst who has your books open in front of them. You don't need to know
report names or accounting jargon — ask the question you actually have, and
Claude can usually figure out which QuickBooks data to pull.

Here's a tour of what's possible, grouped by what you're trying to do. Mix and
match — the real power shows up when you ask a follow-up.

---

## Understand performance

Your income statement, made conversational.

- *"Walk me through this month's P&L versus last month. What moved the most?"*
- *"How did gross margin trend over the last six months?"*
- *"Break down operating expenses by category for Q2."*
- *"Compare revenue this quarter to the same quarter last year."*
- *"We had a rough month — where did the extra spend come from?"*

**Behind the scenes:** profit & loss summary reports, transaction-level P&L
detail, and month-by-month or quarter-by-quarter breakouts on summary reports.

## Check your financial position

The balance sheet and cash, on demand.

- *"What's on our balance sheet right now?"*
- *"What's our current cash position, and how has it trended this year?"*
- *"How much do we owe in total liabilities versus what we hold in assets?"*
- *"Give me a trial balance as of the end of last month."*

**Behind the scenes:** balance sheet, cash flow statement, and trial balance.

## Manage who owes you (and who you owe)

Receivables and payables, without the spreadsheet.

- *"Which customers are more than 60 days past due, and by how much?"*
- *"What's our total outstanding accounts receivable right now?"*
- *"Show me every overdue invoice for [customer name], oldest first."*
- *"Show me everything we owe vendors, aged by how late it is."*
- *"List every open invoice over $10,000."*
- *"Which bills are coming due in the next two weeks?"*

**Behind the scenes:** AR and AP aging (summary and invoice-by-invoice detail),
customer balances, and search across invoices and bills.

## See where revenue comes from

Sales, sliced the way you think about them.

- *"Who were our top ten customers by revenue this year?"*
- *"Break down sales by product line for Q3."*
- *"How does revenue split across our classes/divisions?"*
- *"Which customers grew or shrank the most quarter over quarter?"*

**Behind the scenes:** sales summarized by customer, by product/service, and by
class, with month-by-month or quarter-by-quarter breakouts.

## Dig into spending

Where the money actually went.

- *"Show me my top 25 vendors by spend, month over month."*
- *"What did we spend on software last quarter, broken out by vendor?"*
- *"How much have we paid [vendor name] this year, and on what?"*
- *"Pull every transaction with [vendor name] since January."*

**Behind the scenes:** expenses-by-vendor summaries, vendor balances, and vendor
transaction history for the period you ask about.

## Investigate the ledger

This is the part the consumer tools can't do. Claude can go all the way down to
the individual posting.

- *"Pull the general ledger detail for our marketing expense accounts in Q2."*
- *"Show me every journal entry posted last month."*
- *"What's in account 63000, and what are the biggest entries?"*
- *"Find the transactions that make up this line on the P&L."*

**Behind the scenes:** general ledger detail, chart-of-accounts lookups, and
journal entry search — the underlying records, not just the summary.

## Look up specific records

When you need one exact thing.

- *"Find invoice #1042 and tell me its status."*
- *"Pull up the customer record for [customer name]."*
- *"What products and services do we have set up, and at what prices?"*
- *"Show me the payments we received last week."*

**Behind the scenes:** search-and-retrieve across invoices, bills, customers,
vendors, accounts, items, payments, and journal entries.

---

## Tips for getting great answers

- **Be specific about the time frame.** "Last quarter," "in March," "year to
  date" all work. The clearer the window, the cleaner the answer.
- **Specify cash or accrual when it matters.** If you don't, QuickBooks uses the
  company's default report basis.
- **Ask follow-ups.** "Now break that down by month." "Which vendor drove it?"
  "Show me the actual transactions." Claude keeps the context.
- **Ask for the source.** For any important number, ask Claude to show the report,
  rows, or transactions behind it so you can trace the answer back to QuickBooks.
- **Ask it to reconcile or sanity-check.** "Do these expense categories add up to
  the total?" It can cross-check the numbers it pulled.
- **Name the entity if you know it.** A specific vendor, customer, or account
  name helps Claude pull exactly the right records.
- **Narrow big ledger questions.** General ledger pulls can get large quickly, so
  a clear date range, account, vendor, customer, or account type will produce a
  cleaner answer.

## What it can't do

By design, this connector is **read-only.** Claude can read, summarize, compare,
and explain — but it **cannot create, edit, or delete anything** in your
QuickBooks. No invoices get sent, no entries get posted, nothing changes. It's a
window into your books, not a hand on the controls.

It also cannot make unfinished books finished. Answers reflect the QuickBooks
data available at the time you ask, including any open-period changes,
uncategorized transactions, or close adjustments that have not been posted yet.

For the full reasoning behind that, see
**[Trust & security →](./trust-and-security.md)**.
