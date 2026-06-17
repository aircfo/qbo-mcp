# Architecture Decisions

## 2026-05-26 — Harvest the Intuit OSS repo, don't fork it

The official open-source `intuit/quickbooks-online-mcp-server` (MIT) has
excellent QBO coverage (29 entities CRUD, 11 reports incl. GL/trial balance,
well-parameterized reports) but is single-user, single-company, stdio-only, with
a singleton client every handler hard-imports and tokens in plaintext `.env`.

**Decision:** build our own multi-user remote scaffold and port their
handler/schema logic over with an *injected* per-request client, rather than
fork-and-retrofit (which would mean surgery across 144 singleton-coupled files).
The valuable, copyable asset is the QBO domain coverage; the infrastructure is
the wrong shape and gets rewritten regardless.

## 2026-05-26 — SQLite-on-a-volume for token storage

**Decision:** store per-user Intuit tokens in one encrypted SQLite table on a
Railway volume. Rejected Supabase (overkill) and pure in-memory (would force
Intuit re-consent on every redeploy). The only hard durability requirement is
the rotating Intuit refresh token. Tradeoff: a volume binds to a single
instance — acceptable for an internal team; revisit with Railway Postgres if we
scale horizontally.

## 2026-05-26 — Encrypt tokens, don't hash

**Decision:** AES-256-GCM (`TokenCipher`) with a key from `TOKEN_ENCRYPTION_KEY`.
Intuit tokens are replayed upstream on every call, so they must be reversible —
hashing (the pattern used for downstream-only compare-tokens) won't work here.
GCM also gives tamper detection.

## 2026-05-26 — Downstream auth: opaque DB-backed tokens + durable connection

**Decision:** the MCP access/refresh tokens are opaque random strings, stored
only as SHA-256 hashes in `oauth_tokens` and verified by hash lookup per request;
each carries a `connectionId` used to load the durable (encrypted) Intuit tokens
from the `connections` table. Rejected stateless JWTs: opaque tokens are
revocable — `disconnect_quickbooks` revokes every downstream token for a
connection — which a stateless JWT can't do without a separate blocklist. This
keeps Intuit tokens out of the client's stored bearer, and a server restart
never forces re-consent (the token hashes and the connection row both persist).

## 2026-06-16 — Report tools return flattened rows by default (compact)

A vendor-spend query ("top 25 vendors by spend, by month") forced multiple raw
`get_general_ledger` pulls of ~300 KB–1 MB each — every call exceeded the client
token limit and spilled to disk. ~70%+ of those tokens were report scaffolding
(`MetaData`, `ColData` wrappers, running balances, section summaries) and accounts
the question never needed.

**Decision:** add `flattenReport`/`shapeReport` (pure, in `_format.ts`) and route
every report tool through it. Reports now default to `format: "compact"` —
`{ columns, rows }` keyed by column title, with the section/account header carried
onto each row as `group`. `format: "raw"` still returns the full QBO envelope for
callers that need it. This is a **behavior change** for existing consumers parsing
raw JSON; raw is one param away. Detail reports also take `max_rows` (default
5000) and return a truncation envelope rather than relying on the client to spill.

The highest-leverage fix was structural, not just shaping: `get_expenses_by_vendor`
(QBO `VendorExpenses`) answers the original query in one call. `summarize_column_by`
is reliable on summary reports like VendorExpenses but is reportedly flaky on the
GeneralLedger detail report, so vendor-by-month belongs on the summary tool.

**Unverified (needs live sandbox):** the GeneralLedger `account_type` filter param
name and whether `summarize_column_by` splits GL columns. `node-quickbooks`
forwards any key verbatim as a query param, so a wrong name silently no-ops rather
than erroring — these must be confirmed against a live connection.

## 2026-06-16 — Compact format made lossless + array-encoded (post-test fix)

Live testing caught two problems with the first compact implementation:

1. **It dropped money.** Reconciling a compact P&L came up ~9% / ~$40k/month short.
   The first flatten kept only leaf rows and discarded every section `Summary`.
   But an amount booked *directly* to a parent account (e.g. $40,160 to "63000
   Practice Development") exists ONLY in that parent's subtotal — there is no leaf
   row for it — so dropping summaries lost it. (Summary reports only; the GL is
   unaffected, since every posting there is its own transaction line.)
2. **It wasn't actually token-cheap for detail reports.** A compact GL was only
   ~13% smaller than raw, because every row repeated the full column-title keys
   and a detail report is mostly data, not scaffolding. The "70%+ scaffolding"
   win holds for summary reports, not the GL.

**Decision:** `flattenReport`/`shapeReport` now return
`{ columns, rows, totals }`:

- `rows` and `totals` are **arrays aligned to a single `columns` header** (no
  per-row key repetition) — ~40% smaller rows.
- `totals` holds section subtotals and QBO-tagged computed lines (Gross Profit,
  Net Income), so nothing monetary is dropped. `rows` (leaf data) stays safe to
  sum; `totals` carries the authoritative figures, including parent-direct
  amounts. The truncation envelope caps `rows` but always keeps `totals`.

Honest framing carried into the tool descriptions: flattening alone can't make a
full unfiltered month of GL inline-able — the real levers are the `columns`
projection, the account/vendor/`account_type` filters, and `max_rows`; vendor
spend should use `get_expenses_by_vendor` (a summary report, returns inline).

## 2026-06-16 — Sandbox-verified the GL params; dropped `summarize_column_by` from detail reports

Live testing against a real company resolved the two items flagged "unverified":

- **`account_type` works.** GL with `account_type=Expense` returns only expense
  accounts — balance-sheet, income, and COGS accounts are excluded (282 KB → 61 KB
  for one month). The param name is correct; no change needed.
- **`summarize_column_by` is a silent no-op on detail reports.** QBO's
  GeneralLedger report ignores it — you get one combined column, never per-month
  columns. It's reliable only on *summary* reports (verified on ProfitAndLoss and
  VendorExpenses).

**Decision:** remove `summarize_column_by` from `get_general_ledger` and
`get_profit_and_loss_detail` (same detail-report class). A param that silently
does nothing is worse than no param — a caller would believe they got a monthly
breakout. For a monthly trend, use `get_profit_and_loss` / `get_expenses_by_vendor`
(summary reports, where the split works) or derive the month from each GL row's
`Date`. `summarize_column_by` stays on the summary reports (P&L, balance sheet,
cash flow, expenses by vendor) where QBO honors it.

Also confirmed end to end: the lossless `{ columns, rows, totals }` fix reconciles
exactly (Mar/Apr/May COGS+Expenses match to the dollar; the ~$40k/month of
parent-posted money is recovered via `totals`).
