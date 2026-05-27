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

## 2026-05-26 — Downstream auth: stateless access JWT + durable connection

**Decision:** the MCP access token is a stateless signed JWT carrying a
`connectionId`; the durable Intuit tokens are looked up from SQLite per request.
This keeps Intuit tokens out of the client's stored bearer and means a server
restart never forces re-consent (the signed JWT still verifies; the connection
row still exists).
