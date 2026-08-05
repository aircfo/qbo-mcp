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

A multi-user, remote MCP server. Each user connects **their own** QuickBooks
Online company via Intuit OAuth; the server then exposes that company's data to
the user's AI client (e.g. Claude) through read-only tools. It is intended to be
**publicly reachable** — anyone with the URL can connect their own company.

## Data we handle

| Data | Stored? | Protection |
|---|---|---|
| Intuit access + refresh tokens | Yes (SQLite on a Railway volume) | **Encrypted at rest** (AES-256-GCM); key in env, never on the volume |
| QuickBooks realm id, company name | Yes | Plaintext (not secret) |
| User email (self-reported at connect) | Yes | Plaintext; **unverified** |
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
  created it; mismatches are rejected (403).
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
- **Connect-time email capture** (self-reported, unverified) as a soft
  accountability signal, with an acknowledgment of data access.
- **Open registration** is intentional for a public tool: anyone can register a
  client and connect their own company. This is *not* a cross-tenant risk (see
  threat model) but is an accepted-risk decision (see Limitations).

## Abuse controls

- **Per-connection rate limit** on tool calls (120/min) → 429.
- **Per-IP rate limit** on the public surface (600/min) → 429; `/health` exempt.
- **Request-size caps** (256kb JSON, 16kb form) to prevent memory-exhaustion.
- **Idle session eviction** (30 min) so the in-memory session map stays bounded.
- **Field allowlists** on search tools so only expected fields reach the QBO
  query layer.
- **Process guards** (unhandledRejection/uncaughtException) + a final error
  handler so one bad request can't take the process down silently.

## Threat model

**A malicious user who connects their own QBO company:**
- ✅ Cannot reach any other user's data (isolation above).
- ✅ Cannot read the encryption key or Intuit client secret (server-side env).
- ✅ Cannot write to any books (read-only).
- ⚠️ Could attempt to abuse the shared instance (DoS, registration spam) →
  mitigated by the rate limits + size caps above; not fully eliminated on a
  single instance.

**An attacker against the server:**
- Stealing tokens requires compromising the Railway environment (both the
  encrypted volume *and* the env-held key) — not reachable via the public API.
- Hijacking another session requires a 128-bit-random session id *and* a valid
  bearer for that same connection (session binding).

**The dominant residual risk is custodial:** we hold many users' Intuit tokens,
so a compromise of our infrastructure would expose their QuickBooks access. This
raises the bar on key management, monitoring, and incident response.

## Known limitations / accepted risks

- **Email is unverified** — a deterrent, not identity. (Add verification if
  abuse warrants.)
- **Open registration** — no gate on who may connect. Acceptable for a public
  tool; revisit with an identity layer if abuse warrants.
- **No admin-initiated revocation** — users can self-disconnect
  (`disconnect_quickbooks`), but cross-user/admin revocation needs an identity
  layer (deferred).
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

## Going public: checklist

1. **Intuit production security assessment.** Production apps that connect
   third-party data are subject to Intuit's developer terms and typically must
   pass a security questionnaire (and, above a connection threshold, a paid
   third-party review). **Confirm current Intuit requirements before launch** —
   an unreviewed public app risks suspension. This document is written to double
   as source material for that questionnaire.
2. **Privacy policy** covering: data collected (email, Intuit tokens, company
   metadata), purpose, that financial data is not stored, retention, the
   self-service deletion path (`disconnect_quickbooks`), and a contact.
3. **Terms of service**, linked from the connect page via `TERMS_URL` /
   `PRIVACY_URL`.
4. **A security contact / disclosure path** — **alex@aircfo.com** (subject line
   "Security").

## Reporting a vulnerability

Email **alex@aircfo.com** (subject line "Security") with details and reproduction
steps. Please do not open public issues for security reports.
