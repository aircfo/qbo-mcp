# qbo-mcp

A **multi-user, remote** MCP server for QuickBooks Online. Each user connects
their own QuickBooks company via OAuth; the server stores their Intuit tokens
encrypted and exposes QBO data + actions as MCP tools to Claude.

Built because the official options don't fit a finance team's needs:

- The **hosted Intuit connector** is a consumer funnel — canned report *widgets*,
  no general ledger / chart of accounts / journal entries, AR-only writes.
- The **open-source [`intuit/quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server)**
  (MIT) is comprehensive and well-built, but it's a *single-user, single-company,
  local stdio* tool. We **harvest its QBO domain coverage** (entity/report
  mappings, schemas, refresh logic — with attribution) and wrap it in the remote,
  multi-user infrastructure here.

## What's different here

| Concern | This server |
|---|---|
| Transport | Streamable HTTP + sessions (remote, multi-client) |
| Identity | Google sign-in on an `@aircfo.com` account, re-checked every request; each person then connects a QBO company through Intuit |
| Token storage | **Encrypted** (AES-256-GCM) in SQLite on a Railway volume |
| Tool output | Structured JSON (slimmed), not HTML widgets |
| Tool surface | Curated, typed, well-described subset (not all 143) |

## Architecture

```
MCP client (Claude)
  └─ HTTP /mcp  (Streamable HTTP; Bearer access token → connectionId, resolved server-side)
       └─ per-request QBO client, built from the user's stored + refreshed tokens
            └─ QuickBooks Online API
```

Durable state is a single SQLite database with three tables: `connections` (one
row per connected QuickBooks company — `realmId` + the Intuit access/refresh
tokens, **encrypted** at rest), `oauth_clients` (dynamically-registered MCP
clients), and `oauth_tokens` (the downstream Claude ↔ server OAuth artifacts).
Downstream MCP access/refresh tokens are opaque random strings, stored only as
SHA-256 hashes and verified by hash lookup per request — so they stay revocable
(used on disconnect) and survive a restart without ever forcing Intuit
re-consent.

### Why SQLite on a volume (not Postgres/Supabase)

The only thing that *must* be durable is each user's Intuit tokens (the refresh
token rotates and re-consent is painful). That's one tiny table — a single
encrypted SQLite file on a Railway volume is the simplest durable home. Tradeoff:
a volume attaches to one instance, so this assumes a single running instance
(fine for an internal team; swap to Railway Postgres if we ever scale out).

## Status

- [x] Project scaffold (TS strict, ESM, pnpm, vitest)
- [x] `src/config/env.ts` — boot-time env validation
- [x] `src/store/` — AES-256-GCM `TokenCipher`, SQLite `openDatabase`, `ConnectionStore` (+ tests)
- [x] `src/qbo/` — `IntuitOAuth` wrapper + `QboClientManager` (per-connection client, refresh-on-demand, rotation, in-flight dedup)
- [x] `src/auth/` — `OAuthStore` (SQLite, hashed tokens), `QboOAuthProvider` (SDK `mcpAuthRouter`), Intuit OAuth callback
- [x] `src/transport.ts` + `src/index.ts` — Streamable HTTP + sessions + Express wiring (boots; OAuth discovery + 401 verified)
- [x] First slice tool: `get_company_info`
- [x] Live OAuth round-trip verified against Intuit sandbox (connection persisted, encrypted)
- [x] Batch A — financial reports (read-only): P&L, balance sheet, cash flow, trial balance, general ledger, A/R + A/P aging
- [x] Batch B — ledger read/search: accounts, journal entries, invoices, bills, vendors, customers, items, payments
- [x] Batch C — customer-side reports: A/R + A/P aging detail, sales by customer/product/class, customer balances, transaction lists, class lookup
- [ ] (deferred) Writes — out of scope for read-only v1

## Tools — 42, plus 3 administrative

All data tools are read-only; the only state-changing tool is `disconnect_quickbooks`.

**Company & connection:** `get_company_info`, `connection_status`.
`get_company_info` returns the QuickBooks company profile plus a `connection`
object naming the **realm id**, the environment, and who authorized the
connection — so an identity check can compare the realm QuickBooks itself
reports rather than trusting a company name. `connection_status` returns just
that object and makes **no call to QuickBooks**, so it still answers when
Intuit is slow or erroring.

**Reports:** `get_profit_and_loss`, `get_profit_and_loss_detail`,
`get_balance_sheet`, `get_cash_flow`, `get_trial_balance`, `get_general_ledger`,
`get_expenses_by_vendor`, `get_vendor_balance`, `get_vendor_balance_detail`,
`get_transactions_by_vendor`, `get_aged_receivables`, `get_aged_payables`,
`get_aged_receivables_detail`, `get_aged_payables_detail`,
`get_sales_by_customer`, `get_sales_by_product`, `get_sales_by_class`,
`get_customer_balance`, `get_customer_balance_detail`,
`get_transactions_by_customer`, `get_transaction_list`.
Report tools return a compact, lossless shape by default
(`{ columns, rows, totals }` — array rows aligned to one header; `totals` keeps
section subtotals so amounts posted directly to a parent account aren't lost).
Pass `format: "raw"` for the full QBO JSON. Detail reports accept `max_rows`
(default 5000, at most 50,000, caps `rows`). A full unfiltered month of general ledger is large
regardless — narrow it with `columns`/filters, or use `get_expenses_by_vendor`
for vendor spend (one call, returns inline).

**Ledger read/search** (a `search_*` + `get_*` pair each): accounts, journal
entries, invoices, bills, vendors, customers, items, payments, classes — e.g.
`search_invoices` / `get_invoice`. `search_*` tools take typed `filters`
(field/operator/value), `limit`, `offset`, and sort; `get_*` take an `id`.

**Administrative** (registered only for sessions whose verified address is in
`ADMIN_USERS`, so they are absent from everyone else's tool list):
`list_connections`, `revoke_connection`, `set_writes_enabled`. They read and
write this server's own rows and never touch a ledger.

**Connection:** `disconnect_quickbooks` — revokes the connection with Intuit,
deletes the stored tokens, and ends access (re-authorize to reconnect).

## Environment

| Var | Purpose |
|---|---|
| `PORT` | Server port (default 8080) |
| `PUBLIC_URL` | Public base URL, no trailing slash |
| `DATABASE_PATH` | SQLite path; Railway volume mount in prod (e.g. `/data/qbo-mcp.db`) |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes base64 (`openssl rand -base64 32`) — encrypts tokens at rest |
| `INTUIT_CLIENT_ID` / `INTUIT_CLIENT_SECRET` | Intuit app credentials |
| `INTUIT_REDIRECT_URI` | Must match the Intuit app's registered redirect |
| `INTUIT_ENVIRONMENT` | `sandbox` or `production` |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client; its redirect URI must be `<PUBLIC_URL>/oauth/google/callback` |
| `ALLOWED_DOMAIN` | Workspace domain a signed-in address must belong to (default `aircfo.com`) |
| `ALLOWED_USERS` | `*` for any verified address on that domain, or a comma-separated list. **Empty admits nobody** |
| `ADMIN_USERS` | Comma-separated addresses that additionally get the administrative tools |
| `SERVICE_TOKEN` | Optional. A long shared secret that lets a scheduled job call the read-only `/api` endpoints. **Unset means the `/api` routes are not mounted at all** |
| `SERVICE_PRINCIPAL_ID` | Names that caller in the logs (default `svc:actuals-pipeline`) |

Copy these into a local `.env` (see the table above) before running. For local
work, point `PUBLIC_URL` at `http://localhost:8080`, set
`INTUIT_ENVIRONMENT=sandbox`, and add
`http://localhost:8080/oauth/google/callback` to the Google client's redirect
URIs.

## Joining this repo

New here? **[`ONBOARDING.md`](ONBOARDING.md)** is written for you, including if you build
with Claude rather than by hand: setup, the working loop, the rules that matter, and the
vocabulary. [`CLAUDE.md`](CLAUDE.md) holds the house rules and is loaded automatically by
every Claude Code session in this repo.

## Commands

```sh
pnpm install
pnpm test         # run the vitest suite
pnpm typecheck    # tsc --noEmit
pnpm dev          # run locally with tsx (reads .env)
```

## Attribution

QBO entity/report coverage is adapted from
[`intuit/quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server)
(MIT License).
