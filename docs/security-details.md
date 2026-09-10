---
title: "Security: Technical Detail"
---

> This is the connector's engineering security documentation, published
> verbatim from the project's `SECURITY.md`. For the plain-language version,
> see [Trust & security](./trust-and-security.md).

# Security

This document describes the security posture of qbo-mcp: what data it handles,
how it's protected, the threat model, accepted limitations, and the checklist
for taking it public (Intuit production assessment + privacy/terms).

> This is engineering documentation, not legal advice. Have counsel review the
> actual privacy policy and terms before a public launch.

## What this server is

A multi-user, remote MCP server for **airCFO staff**. Each person signs in with
their `@aircfo.com` Google account and connects a QuickBooks Online company via
Intuit OAuth; the server then exposes that company's data to their AI client
(e.g. Claude) through read-only tools. It is publicly *reachable* but not
publicly *usable*: the URL is not a credential, and an address outside the
allowlist is refused before the flow ever reaches QuickBooks.

## Data we handle

| Data | Stored? | Protection |
|---|---|---|
| Intuit access + refresh tokens | Yes (SQLite on a Railway volume) | **Encrypted at rest** (AES-256-GCM); key in env, never on the volume |
| QuickBooks realm id, company name | Yes | Plaintext (not secret) |
| Caller's email address | Yes | Plaintext (not secret); **verified by Google** at connect time and re-checked on every request |
| Downstream OAuth tokens (access/refresh/codes) | Yes | **Hashed at rest** (SHA-256); only ever compared |
| QuickBooks financial data (P&L, ledger, etc.) | **No** | Fetched live per request, never persisted |

We deliberately **do not persist financial data** — only the tokens needed to
fetch it on demand. That keeps the breach blast radius to "tokens" rather than
"copies of everyone's books."

## Hosting & subprocessors

- **Host.** Railway, **US East (Virginia)** region. A single instance (one
  replica, per `railway.json`) with a persistent volume holding the encrypted
  SQLite database (see `DEPLOY.md`).
- **Subprocessors (parties that process user data):**
  - **Railway** — compute and the volume that stores the encrypted tokens.
  - **Intuit / QuickBooks Online** — upstream data source; the user authorizes it
    directly via OAuth.
  - **Anthropic (Claude)** — the MCP client that receives fetched QuickBooks data
    to generate answers, within the user's own Claude session.
- **No model training.** airCFO does not use customer data to train any model, and
  the server neither persists nor repurposes financial data. Data is transmitted
  to Claude (Anthropic) solely to answer the user's request; Anthropic's handling
  is governed by the user's own Claude account terms and workspace settings.

## Architecture & isolation

- **Per-connection isolation.** A request's QuickBooks client is resolved from
  the `connectionId` bound to the caller's access token. Callers cannot supply a
  `connectionId`, so there is no IDOR path to another tenant's data.
- **Unguessable, hashed credentials.** Access/refresh tokens and auth codes are
  256-bit random values, stored only as SHA-256 hashes.
- **Session binding.** An MCP session may only be driven by the connection that
  created it. A mismatch is answered exactly like an unknown session (404), so a
  caller cannot use the response to learn that a session id exists under another
  tenant.
- **Token-only encryption boundary.** Intuit tokens are encrypted/decrypted at
  the DB layer; raw tokens never touch disk. The encryption key lives in a
  Railway env var, separate from the volume that holds the database.
- **Read-only.** v1 exposes no write tools, so a caller cannot mutate any books.
- **Encrypted in transit.** All traffic is TLS/HTTPS on every hop: client ↔
  server (Railway-terminated HTTPS; the MCP OAuth flow requires it) and server ↔
  Intuit/QuickBooks (Intuit's APIs are HTTPS-only — reads, token refresh, and
  revoke). Combined with at-rest token encryption, sensitive data is never in
  cleartext on the wire or on disk.

## Authentication & authorization

- **MCP OAuth 2.1** (via the MCP SDK) with **PKCE (S256)**, dynamic client
  registration, and short-lived access tokens + rotating refresh tokens.
- **Intuit OAuth 2.0** for the upstream connection; refresh tokens rotate and
  are re-persisted on every refresh.
- **Google sign-in establishes identity** before Intuit is ever contacted. The
  address comes from a signed `id_token` verified against Google, must belong to
  `ALLOWED_DOMAIN`, and must be admitted by `ALLOWED_USERS` — either by name or
  by the explicit `*` sentinel. An empty `ALLOWED_USERS` admits nobody, so a
  variable accidentally cleared fails closed rather than exposing a domain.
- **The allowlist is re-checked on every request**, not only at sign-in, so
  removing someone ends their access immediately instead of whenever their
  token happens to expire.
- **Company confirmation.** Intuit's own company picker decides which company a
  grant covers and this server has no say in it, so after consent the person is
  shown the company name and realm and must confirm before the MCP client
  receives an authorization code. Declining revokes the grant. Without this,
  connecting the wrong company is silent.
- **Client registration stays open** (any MCP client may register), which is not
  a way in: registration issues no access, and every connection is gated by the
  Google sign-in above.

## Abuse controls

- **Per-connection rate limit** on tool calls (120/min) → 429.
- **Per-IP rate limit** on the public surface (600/min) → 429; `/health` exempt.
- **Request-size caps** (256kb JSON, 16kb form) to prevent memory-exhaustion.
- **Idle session eviction** (8 h) so the in-memory session map stays bounded.
  An evicted session is answered with 404, the protocol's expired-session
  signal, so a client re-initialises on its own rather than retrying a dead
  session until a person intervenes.
- **Field allowlists** on search tools so only expected fields reach the QBO
  query layer.
- **Process guards** (unhandledRejection/uncaughtException) + a final error
  handler so one bad request can't take the process down silently.

## Threat model

**Someone outside airCFO who has the URL:**
- ✅ Cannot connect at all. Google sign-in runs before Intuit is contacted, and
  an address outside the allowlist is refused there.
- ⚠️ Can still register an MCP client and reach `/authorize` → mitigated by the
  per-IP rate limit and size caps; registration by itself grants nothing.

**A teammate with a valid connection:**
- ✅ Cannot reach a company they hold no Intuit grant for: a request's
  QuickBooks client is resolved from the connection bound to their own token.
- ✅ Cannot read the encryption key or the Intuit client secret (server-side env).
- ✅ Cannot write to any books (read-only).
- ⚠️ Can connect *any* company they can pass Intuit consent for, and with
  `ALLOWED_USERS=*` any teammate may do so. The confirmation step makes the
  company visible at connect time and `list_connections` makes it auditable
  afterwards, but the server does not restrict which staff may connect which
  client.

**An attacker against the server:**
- Stealing tokens requires compromising the Railway environment (both the
  encrypted volume *and* the env-held key) — not reachable via the public API.
- Hijacking another session requires a 128-bit-random session id *and* a valid
  bearer for that same connection (session binding).

**The dominant residual risk is custodial:** we hold many users' Intuit tokens,
so a compromise of our infrastructure would expose their QuickBooks access. This
raises the bar on key management, monitoring, and incident response.

## Known limitations / accepted risks

- **Domain-wide access by default.** `ALLOWED_USERS=*` admits any verified
  `@aircfo.com` address. Signing in still grants nothing on its own — reaching a
  company's ledger also requires completing Intuit consent for it — but the
  server does not restrict *which* staff may connect *which* client. Narrowing
  to a named list needs no code change.
- **Google is a single point of identity.** A compromised Workspace account is a
  compromised connector session, bounded by the Intuit grants that account
  holds.
- **Single instance** — the volume-backed SQLite design runs on one instance.
  Scale-out requires migrating to Postgres + shared-state rate limiting.
- **Rotating `TOKEN_ENCRYPTION_KEY` orphans all stored tokens** (users must
  reconnect). Treat the key as long-lived and back it up securely.

## Operations

- **Logging/audit.** One structured `mcp_request` line per call
  (`connectionId`, `tool`, `status`, latency); connect/disconnect lifecycle
  events logged with the self-reported email. **Logs never contain financial
  data or tokens.** Emitted to stdout/stderr and captured by Railway; **retained
  ~30 days then rotated**, with access limited to airCFO engineering staff who
  have access to the Railway project.
- **Backups.** The volume is one disk. Losing it = users reconnect (no financial
  data lost, since none is stored). A periodic encrypted copy of the DB file is
  a recommended hardening.
- **Incident response (minimum).** On suspected key/DB compromise: rotate
  `TOKEN_ENCRYPTION_KEY` (invalidates all tokens), force reconnect, and notify
  affected users. Maintain a security contact (below).

## Obligations that outlast going internal

The connector became airCFO-internal in September 2026, so the public-launch
checklist this section used to hold no longer applies. What survives it:

1. **Intuit's developer terms still bind us.** The production app passed
   Intuit's self-attested assessment, and that attestation has to stay true as
   the server changes — this document is the record of what was attested. An
   internal app is not exempt; it is simply well under the connection threshold
   that triggers a review.
2. **Client data still reaches Anthropic**, because that is the point of the
   tool. Nothing is stored on our side beyond credentials and company metadata,
   and airCFO's engagement terms are what cover a client's data being read by
   the firm's own tooling.
3. **A security contact** — **alex@aircfo.com** (subject line "Security").

## Reporting a vulnerability

Email **alex@aircfo.com** (subject line "Security") with details and reproduction
steps. Please do not open public issues for security reports.
