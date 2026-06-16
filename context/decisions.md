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
