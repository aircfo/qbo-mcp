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
| Identity | Per-user OAuth; each user connects their own QBO company |
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
- [ ] (deferred) Writes — out of scope for read-only v1

## Tools (v1) — 30 total

All data tools are read-only; the only state-changing tool is `disconnect_quickbooks`.

**Company:** `get_company_info`

**Reports:** `get_profit_and_loss`, `get_profit_and_loss_detail`,
`get_balance_sheet`, `get_cash_flow`, `get_trial_balance`, `get_general_ledger`,
`get_expenses_by_vendor`, `get_vendor_balance`, `get_vendor_balance_detail`,
`get_transactions_by_vendor`, `get_aged_receivables`, `get_aged_payables`.
Report tools return flattened rows by default (`format: "compact"`) to stay
token-cheap; pass `format: "raw"` for the full QBO JSON. Detail reports accept
`max_rows` (default 5000). For ranking vendors by spend, `get_expenses_by_vendor`
answers it in one call — prefer it over the general ledger.

**Ledger read/search** (a `search_*` + `get_*` pair each): accounts, journal
entries, invoices, bills, vendors, customers, items, payments — e.g.
`search_invoices` / `get_invoice`. `search_*` tools take typed `filters`
(field/operator/value), `limit`, `offset`, and sort; `get_*` take an `id`.

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

Copy these into a local `.env` (see the table above) before running.

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
