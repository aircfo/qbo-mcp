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

## 2026-06-26 — `search_*` tools: bounded by default + compact list-view projection

A Cowork beta tester's setup errored mid-run: `search_accounts` on a 257-account
chart returned ~132 KB and blew the response limit. Root cause was two-fold —
`buildCriteria` only sent a `limit` when the caller passed one (the Zod
"default 100" was description-only, never applied), so an omitted limit became QBO's
"return the whole table"; and search returned full `slimEntity` objects
(`MetaData`, `CurrencyRef`, line arrays, etc., ~500 chars/row).

**Decision:** mirror the report-tool shaping on the ledger search path
(`_search.ts`, `ledger.ts`):

- **Never unbounded.** `buildCriteria` always appends `limit: args.limit ??
  DEFAULT_LIMIT` (100). The guarantee lives in the pure chokepoint, not in the
  model remembering to pass a limit.
- **Compact projection is the default.** Each entity declares `projectionFields`;
  search returns only those (a "list view"). `get_<entity>` stays the full-detail
  path, and `format: "full"` on search is the escape hatch. Applied to all 8
  search tools (invoices/bills/payments carry heavy line arrays too), not just
  accounts. Journal-entry search drops its lines — description now points to
  `get_journal_entry` for them.
- **Paging envelope.** Returns `{ count, results, truncated, next_offset, hint }`
  when the page comes back full. Unlike `shapeReport` (which sees the whole set
  then slices), search applies the limit at the QBO query layer, so truncation is
  *inferred* from `results.length >= limit` — a heuristic whose worst case is one
  extra empty page.

A **behavior change** for callers parsing full search objects; `format: "full"`
and `get_<entity>` both recover the old shape. For a whole COA in one call, the
description tells the model to raise `limit` (compact 257 rows ≈ 26 KB).

## 2026-06-26 — Connect-flow hardening for the public/Cowork surface

Three connect-time issues surfaced in the same beta test.

**Decision:**

- **OAuth callback shows a success interstitial, not a blind 302.** The QBO
  connection is created server-side *before* the redirect, so the only thing that
  fails when the MCP client's loopback (`localhost:3118`) is unreachable is
  delivery of the auth code — but the user saw a raw "Safari can't connect" dead
  end. `intuit-callback.ts` now renders a "✅ QuickBooks connected" page that
  auto-redirects via top-level `meta refresh` (not a subresource — avoids
  https→http-localhost mixed-content blocking), keeps a clickable "Return to
  Claude" link, and reassures that the connection succeeded even if the redirect
  errors. The redirect *destination* remains a client/transport concern we can't
  fully control.
- **Scope coherence.** The server granted the Intuit scope
  `com.intuit.quickbooks.accounting` as the MCP token scope while advertising no
  `scopes_supported` — a mismatch that can read as "Unavailable scope was
  requested." Upstream Intuit is requested correctly (`intuit-oauth.ts`), so this
  is purely the MCP metadata layer. Exported `SCOPE` from `provider.ts` and passed
  `scopesSupported: [SCOPE]` to `mcpAuthRouter` so advertised == granted. (Still
  worth reproducing with the MCP Inspector to confirm the error was this server.)
- **Distinct branding.** `resourceName` and the server `name` were generic
  ("QuickBooks Online MCP" / "qbo-mcp") and collided with Intuit's official
  connector in Cowork. Renamed both to "airCFO QuickBooks" (and the connect-page
  title/heading) so it's unmistakable. The plugin-side `.mcp.json` key + README
  in the `claude-startup-finance` repo still need the matching rename.
