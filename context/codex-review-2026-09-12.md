# Codex pre-launch review — findings, verified against the source

**Date:** 2026-09-12 · **Reviewer:** OpenAI Codex CLI 0.133.0 (`gpt-5.5`, high reasoning),
read-only sandbox over `src/`, `context/`, `docs/`, and the root docs. Brief: a thorough
review ahead of a team-wide launch (roughly 65 people) and the write path that follows it.
**Verification:** every finding below was re-checked against the working tree at `4cdde15`
by Claude on 2026-09-12 before being written down. Where our priority differs from Codex's,
the table in the next section says so and why.

**Tree state at review time:** `pnpm typecheck` clean; **200 tests pass across 18 files**
(run separately under `mise x node@22`; Codex's read-only sandbox cannot run Vitest).

## Verification, and where we differ

All eleven recommendations point at real code at the cited lines. Two are weighted
differently here than Codex weighted them.

| # | Codex | Ours | Verified as | Note |
|---|---|---|---|---|
| 1 | P0 | **P0, small** | Confirmed | `reportsHandler` (`src/api/reports.ts:77-87`) never reads `entry.status`. The unverified-row case should be refused outright, matching the identity gate. The stale-refresh case is a *hint* by design (`service-auth.md`), so refusing it would block pulls that may still work. Refuse unverified; let stale rows try and answer 409 on failure |
| 2 | P0 | **P1** | Confirmed, risk theoretical | The logger does no redaction and five OAuth error paths log `err.stack` or `String(err)`. Node's `stack` is name + message + frames, and the `intuit-oauth` messages seen so far carry no credential, so no leak is known. But the hard rule is absolute and the fix is cheap. Do the small slice now: log `err.message`, never `err.stack`, on credential paths; add key-name redaction in `emit` when convenient |
| 3 | P0 | P0, small | Confirmed | `get_transaction_list`'s `cleared` description (`src/tools/reports.ts:806`) says "with an `account` filter"; the schema has `source_account_type` and no `account`. This is the 09-10 finding #3, still open. `max_rows` on the MCP side is `.min(1)` with no ceiling (`:89-96`); the API caps at 50,000 |
| 4 | P0 | P0 | Confirmed | Repo is `PUBLIC` and Pages is `built` at `aircfo.github.io/qbo-mcp` as of today (checked with `gh`). Docs still offer "Request beta access", describe the deleted email form, and promise the tool "cannot create, edit, or delete anything". Already scheduled as PR 4, week of 09-17 |
| 5 | P0 | P0, for PR 5 | Confirmed | Not a defect in shipped code. No `WRITES_ENABLED` in `env.ts`, no `write_audit` table, only the per-connection flag and its admin tool. This is guidance for the write PR: every guard re-checked at call time, not at tool-list time |
| 6 | P1 | P1 | Confirmed | Known follow-up from the 09-10 revoke incident |
| 7 | P1 | P1 | Confirmed | `api_request` carries no realm or report slug; `/health` is static; backups are "recommended" in `SECURITY.md:162` and nowhere operationalized |
| 8 | P1 | P1, small | Confirmed | `rotateRefresh` (`oauth-store.ts:291`) does `take()` then `issueTokens()` with no transaction; `better-sqlite3` makes wrapping it a few lines |
| 9 | P1 | P1, small | Confirmed | Redirect URI not derived from `PUBLIC_URL`; `engines.node >=20` while `Dockerfile` and CI pin 22 |
| 10 | P1 | P1 | Confirmed | The per-IP limiter (`src/index.ts:47-54`) answers 429 without logging, so a rollout stampede would be invisible |
| 11 | P2 | P2 | Agrees with `multi-client-access.md` | Nothing to do before launch |

**Prior-findings table:** matches our own re-check exactly. Of the nine 09-10 findings,
**two are fixed** (#1 the hardcoded connection state, #8 the missing test), **one is partial**
(#5, the API caps rows but the MCP tools do not), and **six remain open**. Our first pre-check
wrongly marked #3 as fixed by looking at the general-ledger tool, which does have an `account`
filter; the stale text is on the transaction-list tool, so Codex is right that it is open.

**"What is fine" claims spot-checked:** idle eviction is 8 hours (`transport.ts:29`), CI
runs on Node 22, the 404 for vanished sessions is covered by `transport.test.ts`.

## How this review was run

```sh
codex exec -m gpt-5.5 -s read-only \
  -c 'mcp_servers={}' -c 'notify=[]' -c 'model_reasoning_effort="high"' \
  -o <report.md> - < <brief.md>
```

The brief told Codex to stay out of `.env*`, `data/`, `*.db*`, `dist/` and `node_modules/`,
never to quote a credential-shaped value, not to modify files, and not to run Vitest. The
report was scanned for credential-shaped strings before being saved here; none were present.
Wall time was about seven minutes.

---

# Codex's report, verbatim

## Bottom line

Not ready for team-wide launch yet. The core per-person MCP isolation is strong, but the new `/api/reports/:report` machine door can still pull from a selected connection even when the shared selection logic marked that connection `needs_reconnect`, including legacy pre-Google rows. Before wider rollout, fix that, add mechanical log redaction, remove or replace the still-public outsider-facing guide, and close the remaining plausible-wrong report interface traps. The audited write path should not ship until its kill switch, per-call permission checks, dry-run approval token, audit table, and idempotency are built as chokepoints, not just tool-list behavior.

## Recommendations, prioritized

| # | Recommendation | Priority | Effort | Where |
|---:|---|---|---|---|
| 1 | Make `/api/reports/:report` refuse `needs_reconnect` connections before any QBO call | P0 | S | `src/api/reports.ts:77`, `src/api/connections-logic.ts:72` |
| 2 | Add central log redaction and stop logging raw third-party error stacks on credential paths | P0 | M | `src/log.ts:13`, `src/auth/intuit-callback.ts:147`, `src/tools/connection.ts:26` |
| 3 | Fix the transaction-list `account` filter trap and cap MCP `max_rows` | P0 | S | `src/tools/reports.ts:89`, `src/tools/reports.ts:806` |
| 4 | Finish the public teardown and secret-hygiene cleanup before launch messaging | P0 | M | `docs/index.md:11`, `docs/getting-started.md:35`, `.gitignore:3` |
| 5 | Build writes only behind a per-call guard/audit/idempotency spine | P0 | L | `context/internal-conversion-plan.md:102`, `src/tools/admin.ts:104`, `src/store/db.ts:24` |
| 6 | Add one refresh-and-retry on early QBO 401/authentication faults | P1 | M | `src/qbo/client-manager.ts:63`, `src/tools/_shared.ts:23` |
| 7 | Improve launch observability, backups, and service runbooks | P1 | M | `src/api/auth.ts:134`, `src/index.ts:85`, `DEPLOY.md:96`, `SECURITY.md:162` |
| 8 | Make downstream OAuth refresh rotation transactional, then add a short reuse grace if logs justify it | P1 | M | `src/auth/oauth-store.ts:291`, `src/auth/provider.ts:116` |
| 9 | Tighten config/toolchain invariants | P1 | S | `src/config/env.ts:43`, `package.json:8` |
| 10 | Revisit rate-limit telemetry and keys for 65-person rollout | P1 | M | `src/index.ts:47`, `src/transport.ts:21`, `src/api/auth.ts:34` |
| 11 | Defer multi-client switching until the operator surface is decided | P2 | L | `context/product/multi-client-access.md:113` |

## Findings in detail

### 1. Make `/api/reports/:report` refuse `needs_reconnect` connections

**What we found:** `selectConnections()` deliberately marks unverified or stale rows as `needs_reconnect` at `src/api/connections-logic.ts:72-75`. The report endpoint resolves a realm with that same selector at `src/api/reports.ts:77`, but then calls QBO at `src/api/reports.ts:87` without checking `entry.status`.

**Why it matters:** The MCP door correctly refuses legacy unverified rows on every request in `src/auth/provider.ts:147-168`. The service-principal door bypasses that human identity layer by design, so it must not pull from rows the system already knows need reconnection. Otherwise a machine secret can read a legacy connection that a teammate session would be forced to reauthorize.

**What to change:** In `reportsHandler`, return `409 { error: "reauth_required" }` when `entry.status === "needs_reconnect"` before calling `runQboRaw`. Add `src/api/__tests__/reports.test.ts` cases for unverified and stale selected rows proving no QBO client is requested.

### 2. Add central log redaction

**What we found:** `src/log.ts:13-18` serializes arbitrary fields directly. Several credential-adjacent paths log raw stack/string errors: Google verification at `src/auth/google-callback.ts:48`, Intuit callback exchange at `src/auth/intuit-callback.ts:147`, revoke failures at `src/tools/connection.ts:26`, `src/tools/admin.ts:66`, and `src/auth/connect-confirm.ts:72`.

**Why it matters:** The code is careful not to intentionally log tokens, and the service API test asserts that for `SERVICE_TOKEN`. But third-party OAuth errors can include request context. A single raw stack containing an OAuth code, bearer, or refresh parameter would violate the repo’s most important rule.

**What to change:** Put recursive redaction in `log.emit`: redact sensitive key names and credential-shaped substrings before `JSON.stringify`. Prefer small error summaries on OAuth paths. Add `src/__tests__/log.test.ts` covering nested fields, arrays, `Error` objects, and all token/secret variable names without asserting real credential values.

### 3. Fix report interface traps

**What we found:** MCP report `max_rows` is `z.number().int().min(1)` with no ceiling at `src/tools/reports.ts:89-96`; the service API has a 50,000 ceiling at `src/api/reports-logic.ts:26`. `get_transaction_list` tells callers to use `'Uncleared'` with an `account` filter at `src/tools/reports.ts:806`, but that schema has no `account` field; it has `source_account_type` at `src/tools/reports.ts:788`.

**Why it matters:** This is the kind of bug that gives a plausible but wrong accounting answer. A reconciliation query can silently cover the wrong population, and a very large `max_rows` can turn graceful truncation into timeout or response-size failure.

**What to change:** Either add a real `account` filter to `get_transaction_list` or remove that wording until `get_uncleared_transactions(account, as_of)` exists. Add `.max(50_000)` or lower to `maxRowsParam`. Add tests beside `src/tools/__tests__/format.test.ts` or a new report-param test for both behaviors.

### 4. Finish public teardown and secret hygiene

**What we found:** The public docs still market an outsider beta: CTA at `docs/index.md:11-12`, old self-reported email flow at `docs/getting-started.md:35-38`, and “cannot create/edit/delete” at `docs/what-you-can-ask.md:124-129`. Root code now serves an internal-only page at `src/index.ts:91-96`. `.gitignore` ignores `.env` and `.env.local` at `.gitignore:3-4`, but not all `.env.*` variants.

**Why it matters:** Today this is confusing; once writes exist it becomes a trust problem. The public site will say the connector can never change books while the internal server is gaining a narrow write path. A public repo also needs broad env-file ignore rules, because future `.env.production`-style files are easy to create accidentally.

**What to change:** Make the repo private and disable Pages, or replace `docs/` with an internal-only guide before team launch. Update root `README.md`, `SECURITY.md`, and `DEPLOY.md` to describe current internal use and admin tools accurately. Add `.env.*` to `.gitignore` while preserving any intentionally committed examples by explicit negation if needed.

### 5. Build writes behind guard/audit/idempotency chokepoints

**What we found:** The design is sound in `context/internal-conversion-plan.md:102-109`, but current code only has `connections.writes_enabled` and an admin toggle at `src/tools/admin.ts:104-110`. There is no `WRITES_ENABLED` env var in `src/config/env.ts`, no `write_audit` table in `src/store/db.ts:24-64`, and no write-tool implementation yet.

**Why it matters:** Showing or hiding tools at session initialization is not enough for write safety. A write permission or kill-switch change must take effect at call time, including for already-open sessions. The audit trail also has to exist before the first commit, not after the team starts relying on it.

**What to change:** Implement `WRITES_ENABLED`, per-connection `writes_enabled`, verified approver, hard-coded entity allow-list, dry-run HMAC approval token, batch limits, `write_audit`, and `batch_key` idempotency as reusable write service logic. Every write handler should re-check global switch, connection flag, identity, approval token, entity type, batch size, and idempotency immediately before commit. Tests should cover dry-run, commit, edited batch refusal, expired/single-use approval, funding-line refusal, SyncToken conflict, replayed `batch_key`, and audit rows for dry-run and commit.

### 6. Add QBO 401 refresh-and-retry

**What we found:** `QboClientManager` refreshes only when local expiry is near at `src/qbo/client-manager.ts:63-74`. The retry set in `src/tools/_shared.ts:23` covers 429/5xx but not 401/authentication faults from QBO.

**Why it matters:** If Intuit invalidates an access token early, users see a broken connection until local expiry, even when the refresh token could fix it immediately. At team scale, that becomes a support load and can break unattended reads.

**What to change:** Add a single forced refresh-and-retry path for QBO 401/authentication fault codes. Retry exactly once, then return reconnect guidance. Keep it in the shared QBO runner or a narrow client-manager method, with tests using a fake `qb`.

### 7. Improve observability, backups, and runbooks

**What we found:** `api_request` logs method/path/status/ms at `src/api/auth.ts:134-141`, but successful report pulls do not log realm/report. `/health` at `src/index.ts:85-87` does not check database access. Backups are only recommended, not operationalized, in `SECURITY.md:162-164`.

**Why it matters:** Once 65 people and a scheduler depend on this, “is it up?” is not enough. Operators need to know which realm failed, whether QBO was slow, whether auth failed, and whether the volume is safe.

**What to change:** Log successful API report calls with principal, realm, report slug, status, and latency without query strings or tokens. Add an operator runbook for connect/reconnect/revoke/service-token rotation and configure encrypted SQLite volume backups. Consider a `/health` or `/ready` check that verifies DB open/read separately from the unauthenticated liveness probe.

### 8. Harden downstream refresh rotation

**What we found:** `rotateRefresh()` consumes the old refresh token at `src/auth/oauth-store.ts:295`, then issues a new pair at `src/auth/oauth-store.ts:297`. `src/auth/provider.ts:116-126` logs rejected refreshes but intentionally has no grace window.

**Why it matters:** In normal single-process operation this is mostly fine, but a crash between delete and insert strands the Claude-side grant. Concurrent connector refreshes can also race; the loser gets `invalid_grant` and may force manual reconnect.

**What to change:** Wrap consume-and-issue in a SQLite transaction. Keep measuring `refresh_token_rejected`; if it appears in production, add a short reuse grace that returns the same rotated pair for the same client.

### 9. Tighten config/toolchain invariants

**What we found:** `INTUIT_REDIRECT_URI` is only validated as a URL at `src/config/env.ts:43`; it is not checked against `PUBLIC_URL + /oauth/intuit/callback`. `package.json:8-10` allows Node `>=20`, while Docker and CI are pinned to 22 at `Dockerfile:1` and `.github/workflows/ci.yml:17-19`.

**Why it matters:** Redirect drift fails late, after a person has already gone through Intuit consent. The Node range is not a production risk, but it keeps the local ABI failure easy to hit.

**What to change:** Derive `INTUIT_REDIRECT_URI` from `PUBLIC_URL`, or add a `superRefine` equality check. Set `engines.node` to `22.x`.

### 10. Revisit rate-limit telemetry and keys

**What we found:** The global public backstop is per-IP at `src/index.ts:47-54` and does not log when it fires. Tool calls are per connection at `src/transport.ts:21`; service API is per principal at `src/api/auth.ts:34`.

**Why it matters:** Per-IP is a coarse control for a team using shared office networks or common Claude egress IPs. During rollout, 65 people and multiple claude.ai connectors can create thundering-herd initialization patterns.

**What to change:** Log IP limiter hits with path and method, not headers. Watch rollout logs before changing limits. If it fires on legitimate traffic, split limits by surface or use a higher unauthenticated budget for OAuth discovery/registration while keeping per-connection and service-principal limits tight.

### 11. Defer multi-client switching

**What we found:** `context/product/multi-client-access.md:113-129` recommends waiting until the operator surface is decided. The current per-token model binds one connection to one realm, which is the strongest isolation property in the system.

**Why it matters:** A per-call company selector would make wrong-client reports possible and plausible. That risk matters more than convenience when outputs feed accounting work.

**What to change:** Do not change the connection model before launch. If claude.ai/Cowork becomes the chosen surface, first prove path-scoped MCP/OAuth metadata with one client path before building a slug registry.

## Status of the 2026-09-10 findings

| # | Prior finding | Current state | Evidence |
|---:|---|---|---|
| 1 | `connection_status` always reports unverified and writes-disabled | Fixed | `src/tools/_connection-summary.ts:49-55`; tests at `src/tools/__tests__/connection-summary.test.ts:31-45` |
| 2 | `revoke` type declaration invites the Sept 10 incident | Still open | Wrapper is correct at `src/qbo/intuit-oauth.ts:99-100`; declaration is still wrong at `src/types/intuit-oauth.d.ts:41` |
| 3 | Tool description promises nonexistent `account` filter | Still open | `src/tools/reports.ts:806`; no `account` field in `get_transaction_list` schema |
| 4 | No refresh-and-retry when QBO answers 401 | Still open | `src/qbo/client-manager.ts:63`; `src/tools/_shared.ts:23` |
| 5 | `max_rows` has no upper bound | Partially fixed | API caps at `src/api/reports-logic.ts:26`; MCP schema still uncapped at `src/tools/reports.ts:89` |
| 6 | `INTUIT_REDIRECT_URI` not checked against `PUBLIC_URL` | Still open | `src/config/env.ts:43` |
| 7 | Refresh-token rotation race | Still open, instrumented | `src/auth/provider.ts:116-126`; `src/auth/oauth-store.ts:291-306` |
| 8 | No test covers `connection_status` contract | Fixed | `src/tools/__tests__/connection-summary.test.ts:31-103` |
| 9 | `engines.node` allows `>=20` | Still open, low risk | `package.json:8-10`; production pinned by `Dockerfile:1` |

## What is fine

- Per-person MCP access is bound server-side to `connectionId`; callers cannot supply a different realm/connection in tool args.
- Google sign-in runs before Intuit, uses the verified ID token, and the allowlist is re-checked in `verifyAccessToken`.
- Downstream MCP tokens are opaque and hashed at rest; Intuit tokens are AES-GCM encrypted at the store boundary.
- Service API auth is absent-by-default, constant-time after hashing, CORS-excluded, and separately rate-limited.
- MCP unknown/cross-connection sessions now return 404, and idle eviction is 8 hours.
- Compact reports preserve `totals`, including parent-account subtotal rows; search tools are bounded by default and signal truncation.
- CI exists on Node 22 and runs typecheck plus Vitest.

## Scope limits

- I did not open `.env`, `.env.*`, `data/`, any database files, `dist/`, or `node_modules`.
- I did not run the test suite, per your sandbox constraint; coverage notes come from reading tests.
- I did not call live QuickBooks, Railway, GitHub settings, or production logs. Public repo/Pages exposure is assessed from your statement plus the checked-in `docs/` content.
- I could not verify current deployed environment variables, service-token state, Railway backups, log retention, or actual branch protection settings.