---
layout: default
title: Overview
nav_order: 1
permalink: /
---

# Talk to your QuickBooks. In plain English.

Connect your QuickBooks Online company to Claude and just ask:

> *"How did margins move from Q1 to Q2?"*
> *"What did we spend on software last quarter, by vendor?"*
> *"Which customers are more than 60 days past due?"*

No exports. No pivot tables. No custom report-building. You ask, Claude reads the
QuickBooks data your company has today, and you get an answer with the numbers
behind it.

---

## What it is

A secure connector that gives Claude **read-only** access to your QuickBooks
Online data. Once it's connected, Claude can pull your P&L, balance sheet, cash
flow, general ledger, AR/AP aging, vendor spend, and individual transactions —
and reason over all of it in one conversation.

It is **read-only by design.** Claude can look at your books and change nothing.
Our server does not store your financial data: each answer is fetched live from
QuickBooks, returned to Claude for that conversation, and not persisted by us.

## Who it's for

- **Founders and operators** who live in their numbers but don't want to live in
  QuickBooks. Get a straight answer without building another report.
- **Finance and accounting teams** who want a faster way to investigate the
  ledger — drill from a P&L line into the underlying transactions in seconds.
- **Fractional CFOs and bookkeepers** (like us at airCFO) who manage many clients
  and need to move quickly across a lot of books.

If QuickBooks has the data and the question is read-only, you can usually ask it
here in plain English.

## Why we built it

We're airCFO — we run finance and accounting for early-stage companies, so we
spend all day in QuickBooks. When we tried to put an AI in front of our clients'
books, the existing options didn't fit:

- **Intuit's own AI connector is built for consumers, not finance teams.** It
  hands back a handful of canned report *widgets* — and it can't touch the
  general ledger, the chart of accounts, or journal entries. That's most of what
  a finance person actually needs.
- **The open-source developer tool is powerful but built for one person on one
  laptop** — one company, running locally, with credentials sitting in a plain
  text file. That's not something you can safely hand to a room full of founders.

So we built the version we wanted: **multi-user, hosted, secure, and with real
access to the ledger** — not just the surface-level summaries. Anyone can connect
their own QuickBooks company; everyone's data stays walled off from everyone
else's; and the whole thing is shaped so Claude can read deeply without choking
on noise.

## How it's different

| | Intuit's hosted AI connector | This connector |
|---|---|---|
| **Depth of data** | Canned report widgets only | Full reports **+ general ledger, chart of accounts, journal entries, individual transactions** |
| **Who can use it** | One consumer at a time | Multi-user — each person connects their own company |
| **What it can do** | Mixed read/limited writes | **100% read-only** — it cannot change your books |
| **Your financial data** | — | **Not stored by us** — fetched live and returned to Claude for the answer |
| **Security** | — | Tokens **encrypted at rest**; self-serve disconnect anytime |

## What you can ask

A few examples (see **[What you can ask →](./what-you-can-ask.md)** for the full
gallery):

- *"Walk me through this month's P&L versus last month — what moved?"*
- *"Show me my top 25 vendors by spend, month over month."*
- *"What's my current cash position and how has it trended this year?"*
- *"List every invoice over $10k that's still open."*
- *"Pull the general ledger detail for our marketing expense accounts in Q2."*

## How to get it

This connector is currently in a **gated beta.** We're rolling it out to a
limited group of founders and finance teams while we keep the experience fast and
reliable.

**[Request beta access →](mailto:alex@aircfo.com)**

Once you're in, connecting takes about two minutes —
see **[Getting started →](./getting-started.md)**.

## The short version

It's the fastest way to get a real answer out of your QuickBooks — ask in plain
English, get the numbers behind it, and never worry that anything changed in your
books, because the connector can only read. Built by a finance team, for finance
teams.
