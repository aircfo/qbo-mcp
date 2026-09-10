# Workplan — qbo-mcp internal conversion

**Ruled:** 2026-09-10 (Alex; the seven rulings in `internal-conversion-plan.md` §2, logged in
`decisions.md`) · **Governs:** 2026-09-11 → 2026-10-02, then October · **Shape:** one pull request
per row, in order; each names its files, its tests, and what "done" means. Gap ids (G1…G16) and
phases (P0…P5) are the plan's.

**Who.** Alex drives the Claude Code sessions and owns the Railway and Google Cloud settings. Kevin
verifies each PR on his read-only runs from `bookkeeping-automation/clients/aircfo/`. PR 3 (identity)
and PR 5 (writes) deserve a second pair of eyes from Engineering before merge; they are the two that
change who can do what to a client's books.

**How every PR runs.** Node 22 locally (`nvm use 22` or mise; Node 26 breaks the SQLite tests),
`pnpm install`, `pnpm typecheck && pnpm test`, feature branch `feat/…` or `fix/…`, conventional
commits, PR against `main`, CI green (PR 1 adds CI), merge. Merging to `main` **is** the production
deploy (Railway auto-deploys). Verify each deploy with `railway logs` before calling the row done.

## P0 · Before the code — **proposed answers, 2026-09-10, awaiting Alex's approval**

| # | Item | Owner | Done when |
|---|---|---|---|
| 0.1 | Rulings logged in `context/decisions.md` | Claude | **done** 2026-09-10 |
| 0.2 | Identify `aarondras@gmail.com` | Alex | **researched — see below.** Almost certainly **Aaron Drasner, Controller, Union Square Donuts**: HubSpot contact `aaron@unionsquaredonuts.com`, created 2026-06-18, source `asg-webinar`, lifecycle **lead**. Awaiting Alex's call between notify-and-offboard (recommended), an allowlist exception, or a silent cut |
| 0.3 | Google OAuth client for qbo-mcp | Alex, ~10 min | **spec below, ready to execute.** Both redirect URIs now known; the sandbox host is `qbo-mcp-sandbox.up.railway.app` |
| 0.4 | `ALLOWED_USERS` / `ADMIN_USERS` | Alex | **list below, from the production table + the Front roster.** One value is missing and it is load-bearing: Kim's sign-in address |
| 0.5 | Tell the team | Alex | **draft below.** The re-auth notice is now the only part that still matters; the reconnect fix shipped 2026-09-10 |
| 0.6 | Kevin logs re-auth events | Kevin | **draft below.** Partly superseded: the server now measures this itself, so Kevin's log is the human cross-check |

### 0.2 — who `aarondras@gmail.com` is, and what to do about him

**The evidence** (Gmail, Front contacts, HubSpot, the Front teammate roster, and the production
database, 2026-09-10):

| Fact | Source |
|---|---|
| Not an airCFO teammate — absent from the 65-person Front roster | Front |
| No correspondence with Alex, ever | Gmail (`aarondras`, `drasner`, `unionsquaredonuts`) |
| **`Aaron Drasner`, job title Controller, `aaron@unionsquaredonuts.com`**, created 2026-06-18, `hs_analytics_source_data_1` = **`asg-webinar`**, lifecycle **lead** | HubSpot |
| Connects through **claude.ai's custom-connector flow**, not the plugin — he was given the URL and added it himself | `oauth_clients` join: all five of his connections use the `Claude` client |
| Five connections to realm **719325880** from 2026-06-29 to 2026-09-06; 75 tool calls; token refreshed **2026-09-10 17:21 UTC** | production database + logs |
| **The second-heaviest user of the whole server**, after Alex | 293 + 138 requests on his two most recent connections |

`aarondras` is the first nine characters of `Aaron Dras`ner, and the timeline fits exactly: HubSpot
lead on 06-18 from the ASG webinar campaign, webinar 06-23, first QuickBooks connection 06-29. Alex
will recognise the name either way — this is an inference from converging evidence, not a
confirmed identity.

**Recommendation: notify, then offboard on the PR 3 date. Do not cut him silently.** He is a
controller at a real business who has been running our connector against his own books for ten
weeks and used it today; he is also an open sales lead. A silent cut-off on 09-21 reads as a broken
tool, and it is the worst outcome available for a lead who has already shown he wants this.

| Option | What it costs | Verdict |
|---|---|---|
| **Notify and offboard** — Alex sends one short note before 09-21: the hosted connector is becoming internal, here is the self-host path (the repo is MIT, the plugin's README already documents it), and if he wants the managed version, let's talk | One email. Keeps the ruling intact and turns the offboard into a sales conversation | **Recommended** |
| Allowlist him | Ruling 2 makes identity `@aircfo.com`-only, so this needs a per-connection exception — exactly the open front door PR 3 exists to close, kept open for one person and no policy for the next | Not recommended |
| Silent cut | Nothing to write. He discovers it as a failure, mid-month, on his own books | Not recommended |

### 0.3 — the Google OAuth client, ready to create

Same Google Cloud project as `aircfo-mcp`, so one consent screen serves both connectors.

| Field | Value |
|---|---|
| Type | Web application |
| Name | `qbo-mcp (airCFO QBO Gateway)` |
| User type | Internal (Workspace) |
| Authorized redirect URI 1 | `https://qbo-mcp-production-5667.up.railway.app/oauth/google/callback` |
| Authorized redirect URI 2 | `https://qbo-mcp-sandbox.up.railway.app/oauth/google/callback` |

Then `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` into **both** Railway projects
("QBO MCP Server" and "QBO MCP (Sandbox)"). No scopes to configure beyond the defaults: the gate
uses `openid email profile` and reads the verified `id_token`, never Google data.

**Worth knowing:** the sandbox project auto-deploys `main` too — it is running the same
`ebaa7ff8` as production right now. So PR 3's and PR 5's code reach the sandbox the moment they
merge, which is what makes sandbox-first proving cheap. The switch that keeps them apart is
`WRITES_ENABLED`, set per project.

### 0.4 — the allowlist, from evidence

Everyone below either connected or started a connection against this server, or is named in the
September plan as running a close. Comma-separated, lowercase, on both Railway projects.

```
ALLOWED_USERS=alex@aircfo.com,david@aircfo.com,johannes@aircfo.com,kevin@aircfo.com,
kettia@aircfo.com,romicca@aircfo.com,aivic@aircfo.com,grace.cuya@aircfo.com,
carlos.damico@aircfo.com,justin@aircfo.com,kristin.miller@aircfo.com
ADMIN_USERS=alex@aircfo.com,david@aircfo.com
```

Provenance: the first seven created connections; `grace.cuya` and `carlos.damico` submitted the
connect page and never completed (the funnel leak); `justin@aircfo.com` is Justin McLoughlin, who
signs the registers; `kristin.miller@aircfo.com` runs client closes in October per the vision page.
Two admins rather than one so revoking a connection never waits on one person.

**The gap, and it matters more than the rest: Kim has no address here.** Front has no individual
teammate named Kim — `kim@aircfo.com` is a shared "Ops Team" seat — and the repo only ever calls her
"Kim, Sr Accountant". Under rulings 2 and 3 the approver on every write is a **verified
`@aircfo.com` Google account**, so if Kim works from a shared mailbox or a non-`aircfo.com` address
she cannot approve a batch as herself, and the write path's whole accountability story fails at the
one person who posts. Three ways out, Alex's call: give Kim her own `@aircfo.com` Google account
before 09-21; or route September's approvals through Kevin or Justin and let Kim work the worksheet
as she does today; or accept dry-run-only for September, which is already the plan's fallback.

### 0.5 — the team notice, drafted

Post once now, and again the day before PR 3 deploys.

> **QuickBooks connector, two changes.**
> **Fixed today.** The connector losing its session after an hour — the one where `/mcp` reconnect
> didn't help and you had to disconnect and re-authenticate — is fixed and deployed. It was our bug:
> the server answered a dead session in a way Claude couldn't recover from. If you still hit it after
> today, tell me the time and I'll read it out of the logs.
> **Coming Mon 09-21.** Sign-in moves to your Google `@aircfo.com` account, and the connector
> becomes airCFO-only. On that day you'll re-authorize each client folder once — `/mcp` from the
> folder, sign in with Google, pick the client's company in Intuit as usual. Once. After that the
> connect page will show you which company and which realm you just connected, so a wrong-company
> grant is visible instead of silent.

### 0.6 — Kevin's cross-check, drafted

> Kevin — the session defect (#52) is fixed and deployed as of this afternoon. Two asks while you run
> the August rehearsal: (1) if a connector ever tells you it needs authentication again, note the
> date and time in the packet's *Steps observed* — I can match it to the server logs and see whether
> it's the same cause or a new one; (2) at least once, leave a session idle for more than half an
> hour and then make a tool call, and tell me whether it just worked. The server measures this now,
> but your side is the one that counts.

## PR 1 · `fix/session-404-timeouts-ci` — unattended reads (P1) · **open as [#13](https://github.com/aircfo/qbo-mcp/pull/13), CI green, awaiting review** (2026-09-10, ahead of the window)

**Closes G1, G2, G14, G16.** The two-line fix that ends the hourly re-auth, plus the guards that
make a failed QuickBooks call say why.

| File | Change |
|---|---|
| `src/transport.ts` | `handleMcpPost`: when `mcp-session-id` is present and the map has no such session, answer **404** with the JSON-RPC body `{ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }` and log `session_not_found`; only build a new transport when the header is absent (an `initialize`). `withSession` (GET, DELETE): unknown or missing session → the same 404 (was 400). `SESSION_IDLE_MS` 30 min → 8 h. Add `email` to the `mcp_request` line once PR 3 supplies it |
| `src/tools/_format.ts` | `withTimeout(promise, ms, label)`; `qboErrorMessage(err)` — pulls `Fault.Error[0].Message` / `Detail` / `code` and the HTTP status out of a node-quickbooks error into one sentence |
| `src/tools/_shared.ts` | `runQbo`: wrap the call in `withTimeout(60_000)`; on HTTP 429 / 500 / 502 / 503 / 504 retry once after 1 s, once more after 3 s; tool errors use `qboErrorMessage`; log `qbo_upstream_error` with status, code and ms |
| `src/auth/provider.ts` | log `refresh_token_rejected` (with client id) when `exchangeRefreshToken` fails and `auth_code_rejected` when the code exchange fails — this is what makes the secondary refresh-race hypothesis measurable |
| `src/tools/reports.ts` | `account_type` becomes `z.enum` of the fifteen QBO values (CamelCase); a `requireBothDates(args)` guard on every report that takes `start_date` / `end_date` returns a tool error naming both when only one is passed |
| `vitest.config.ts`, `src/__tests__/setup-env.ts` | Test env: `TOKEN_ENCRYPTION_KEY` (random 32 bytes), dummy `INTUIT_*`, `PUBLIC_URL`, `DATABASE_PATH=":memory:"` — so modules that import `deps.js` load under vitest |
| `src/__tests__/transport.test.ts` | Express app on port 0 with a stub middleware setting `req.auth.extra.connectionId`: `initialize` without a header → 200 and an `mcp-session-id`; POST with an unknown id → 404, code −32001; GET and DELETE with an unknown id → 404; known id, other connection → 404; known id, same connection → 200 |
| `src/tools/__tests__/format.test.ts` | `qboErrorMessage` on a real Fault shape and on a plain Error; `withTimeout` rejects after the deadline and passes a fast result through |
| `src/tools/__tests__/reports-params.test.ts` | the date guard and the `account_type` enum (pure helpers) |
| `.github/workflows/ci.yml` | on pull request and push to `main`: Node 22, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`. Alex: branch protection on `main` requiring the check |

**Done when:** CI green and merged; over the next 48 h `railway logs -n 5000 --json -f mcp_request`
shows the 400 share falling from 31% toward zero and `session_not_found` lines appearing in their
place; Kevin leaves a session idle for more than 30 minutes and the next tool call succeeds without
`/mcp`; a deliberately slow call (or the next Intuit slowness) returns a tool error within 60 s
naming the fault instead of a 504 from the edge.

**As built** (2026-09-10). 81 tests pass on Node 22, CI green on the first run. Two additions to the
list above, both to make the fix checkable: `mcp_request` gained a `method` field, and GET and DELETE
are logged at all (only POST was, which is why every 400 measured in §1 was a POST). Two subtractions:
no separate `reports-params.test.ts` — the date guard is tested beside the other pure helpers in
`format.test.ts`, and a zod enum is declarative config, not logic worth a test; and no grace window on
refresh rotation — `refresh_token_rejected` now measures whether that second hypothesis is real
before anyone writes code for it. Also corrected two stale claims in `SECURITY.md` and its published
copy (session mismatch answered 403, idle eviction 30 min).

**The post-merge check, in one place.** Merging deploys; then over 48 h:

```sh
railway logs -n 5000 --json -f 'mcp_request'                                  # 400 share, from 31%
railway logs -n 5000 --json -f 'session_not_found'                            # what replaces them
railway logs -n 5000 --json -f 'refresh_token_rejected OR qbo_upstream_error'  # the second hypothesis
```

## PR 2 · `feat/connection-identity-tools` — realm, status, no orphans (P1) · **open as [#14](https://github.com/aircfo/qbo-mcp/pull/14)** (2026-09-10, ahead of the window)

**Closes G3, G4, G10 (description), G15 (company name).**

| File | Change |
|---|---|
| `src/tools/company.ts` | `get_company_info` returns `{ realmId, environment, connection: { authorizedBy, connectedAt, lastRefreshAt }, company }` where `company` is the QBO CompanyInfo as before. New tool `connection_status` (no QuickBooks call): realm, environment, authorized by, connected at, last refresh, `writesEnabled` (false until PR 5) |
| `src/store/connection-store.ts` | `findByRealmAndEmail(realmId, email)`, `setCompanyName(id, name)`; `updateTokens` already exists |
| `src/auth/connection-reconcile.ts` (new, pure with injected stores) | given the Intuit token set and the pending auth: if a row exists for (realm, email) → best-effort revoke the **old** Intuit refresh token at Intuit, `updateTokens` on the existing row and **reuse its id** (other Claude Code sessions holding that connection keep working); else `create`. Then fetch CompanyInfo once and store `company_name` |
| `src/auth/intuit-callback.ts` | calls `reconcileConnection` instead of `create` |
| `src/tools/reports.ts` | `get_transaction_list` description says plainly that `cleared: "Uncleared"` with an `account` filter is the uncleared-items list (G10) |
| tests | `connection-store.test.ts`: `findByRealmAndEmail`, `setCompanyName`. `connection-reconcile.test.ts`: new realm → create; same realm and email → update in place, old token revoked, id unchanged; revoke failure logged and not fatal |

**Done when:** `get_company_info` on the airCFO connection returns realm `793988035`; a second
authorization by the same person for the same company does not add a row to `connections`
(check with `context/prod-query.js`); Kevin's registry PR (see PR 4) switches the identity check to
compare the realm.

**As built** (2026-09-10). One deliberate departure: `get_company_info` keeps the company profile's
fields at the **top level** and adds a single `connection` key, rather than nesting the payload under
`company` as this plan said. Kevin is rehearsing against production this week and every identity
check reads `CompanyName`/`LegalName`; re-shaping that tool mid-rehearsal buys nothing. The company
name is cached on first *read* rather than during the connect flow, so a slow Intuit call cannot
stall an OAuth round trip and all 37 existing rows self-heal as they are used. Added beyond the list:
`session_id_missing` logging, which is what lets the PR 1 log check separate a dead session from a
request that named no session at all. A test caught a real flaw on the way: `created_at` is
millisecond-resolution, so `findByRealmAndEmail` orders by `rowid` too or a tie returns the older row.

## PR 3 · `feat/google-identity` — who is calling (P2) · Wed 09-16 → Mon 09-21 · 1–2 sessions · Engineering review

**Closes G5, G7; removes the public connect page.** Copies `aircfo-mcp`'s gate: `src/auth/google-idp.ts`
(`googleAuthUrl`, `verifyGoogleCode` on `google-auth-library`'s `OAuth2Client`, scopes
`openid email profile`, verified `id_token` is the source of truth) and its per-request allowlist
re-check.

| File | Change |
|---|---|
| `package.json` | add `google-auth-library` |
| `src/config/env.ts` | add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (required), `ALLOWED_USERS` (comma list → lowercase array), `ALLOWED_DOMAIN` (default `aircfo.com`), `ADMIN_USERS`. Remove `TERMS_URL`, `PRIVACY_URL`, `DOCS_URL`, and the dead `JWT_SIGNING_KEY` from `.env` |
| `src/auth/google-idp.ts` (new) | as in `aircfo-mcp`; redirect URI `${PUBLIC_URL}/oauth/google/callback` |
| `src/auth/access.ts` (new) | `isAllowedUser(email)` = verified, ends with `@ALLOWED_DOMAIN`, in `ALLOWED_USERS`; `isAdmin(email)` |
| `src/auth/provider.ts` | `authorize()` stores the pending auth (client, redirect, PKCE, MCP state) and redirects to Google with the state. `verifyAccessToken()` loads the connection, requires `authorized_by` non-null **and** `isAllowedUser(authorized_by)` — so legacy rows re-authenticate once and a de-listed person is cut off on their next call; `extra` carries `{ connectionId, email }` |
| `src/auth/google-callback.ts` (new) | `GET /oauth/google/callback`: verify the code → gate → on refusal a plain page "not on the allowlist — ask Alex" and a `login_denied` log line; on success attach the verified email to the pending auth and redirect to Intuit |
| `src/auth/intuit-callback.ts` | after `reconcileConnection` (PR 2) with `authorized_by` = the verified email, render the **confirmation page** (G5): company name, realm, environment, "connecting as you@aircfo.com", **Continue** / **Wrong company**. Store a `pending_confirm` row (10 min) carrying connection id, client, redirect, PKCE |
| `src/auth/connect-confirm.ts` (new) | `POST /connect/confirm` → consume `pending_confirm` → issue the auth code → existing success page → redirect to the client. `POST /connect/cancel` → revoke the Intuit token, delete the row if it was created in this flow, "Nothing was connected" page |
| `src/auth/connect-page.ts`, `src/auth/connect-start.ts` | deleted |
| `src/store/db.ts` | `ensureColumn(connections, "authorized_by", "TEXT")`, `ensureColumn(connections, "writes_enabled", "INTEGER NOT NULL DEFAULT 0")`; the session reaper also deletes `oauth_tokens` rows expired more than 7 days (G15) |
| `src/tools/admin.ts` (new) | registered only when the session's email `isAdmin`: `list_connections` (id, realm, company, authorized by, connected, last refresh, writes enabled), `revoke_connection(id)` (Intuit revoke, MCP tokens revoked, row deleted), `set_writes_enabled(id, enabled)` |
| `src/transport.ts` | `email` on every `mcp_request` line |
| `src/index.ts` | routes: drop `/connect/start`; add `/oauth/google/callback`, `/connect/confirm`, `/connect/cancel`; `/` returns a one-line "airCFO QBO Gateway — internal" page; `resourceName` stays "airCFO QBO Gateway" |
| tests | `access.test.ts` (domain, allowlist, case, unverified email refused); `google-callback` gate with an injected verifier; `pending_confirm` issue/consume/expiry in `oauth-store.test.ts`; `provider.test.ts`: `verifyAccessToken` refuses a legacy row (no `authorized_by`) and a de-listed email; `admin` tools registered for an admin session only |

**Deploy order.** Sandbox project first with the real Google client and a two-person allowlist;
confirm a non-listed Google account is refused and the confirmation page shows the sandbox company.
Then production on a **Monday morning** (09-21) after the 24 h notice: every teammate re-runs `/mcp`
once per client folder and the claude.ai connector once. Watch `login_denied` for the first day.

**Done when:** a Google account outside the allowlist cannot connect; `connection_status` shows the
teammate's verified email; removing an email from `ALLOWED_USERS` blocks that person's next call
without a redeploy of anything else; `list_connections` shows every row with a company name; the
Gmail user is either allowlisted or refused, per 0.2.

## PR 4 · `chore/teardown` + two sibling PRs — the public surface (P2) · Thu 09-17 → Fri 09-18, parallel to PR 3 · ½ session each

**Closes G15 (visibility) and the plan's §5.**

| Where | Change |
|---|---|
| GitHub settings (Alex) | `gh repo edit aircfo/qbo-mcp --visibility private --accept-visibility-change-consequences`; disable Pages (`gh api -X DELETE repos/aircfo/qbo-mcp/pages`) |
| `docs/` | delete the Jekyll site. The getting-started content that still applies to teammates moves into `README.md` |
| `README.md` | rewrite for the internal posture: what it is, who may use it (allowlist), how to connect from a client folder, the identity check with the realm, the read tools, the write tools and their approval flow (PR 5), the admin tools, operations. Keep the Intuit OSS attribution and `LICENSE` |
| `SECURITY.md` | rewrite: team identity, write controls, the audit table, what the tool can do to a client's books and who can do it, incident response (rotate `TOKEN_ENCRYPTION_KEY`, revoke, notify). Drop the "going public" checklist and the `docs/security-details.md` sync note |
| `DEPLOY.md` | the Google client setup, the new variables, and a **Sandbox** section: the "QBO MCP (Sandbox)" Railway project is this same code with `INTUIT_ENVIRONMENT=sandbox`, used to develop and prove writes |
| `context/intuit-launch-requirements.md` | one line at the top: superseded by the internal decision; kept for the pricing facts |
| `aircfo/claude-startup-finance` (sibling PR) | remove the hosted URL from `plugins/finance-contextos/.mcp.json`; README rows 64 and 157 become "self-host qbo-mcp and point the plugin at your deployment"; `CHANGELOG`; version 0.9.1. The context-builder skill already degrades without the connector |
| `bookkeeping-automation` (sibling PR) | `connectors/registry.json` qbo: `identityCheck` compares `realmId` from `get_company_info` to the client README; `authRunbook` gains the Google sign-in step and drops the #52 defect note once PR 1 is verified; `playbooks/00-operator-setup.md` and `01-scaffold-and-connect.md` the same; key question #52 → `answered` with the date and the cause |

**Done when:** `gh repo view` says private; the Pages URL returns 404; the plugin's connector file no
longer names our deployment; the registry and playbooks describe the new flow.

## PR 5 · `feat/writes` — categorize and post, approved (P3) · Mon 09-21 → Fri 09-25 · 2–3 sessions · Engineering review

**Closes G6.** Built and proven on the Sandbox project first. Plan §4 is the design; this is the
file list.

| File | Change |
|---|---|
| `src/store/db.ts` | table `write_audit` (id, connection_id, realm_id, approver_email, tool, mode, batch_key, payload_hash, item_count, items JSON, status, error, started_at, finished_at); unique index on (connection_id, batch_key) where `batch_key` is not null; `oauth_tokens` kind `approval` for single-use approval tokens |
| `src/config/env.ts` | `WRITES_ENABLED` (boolean, default false). The approval-token key is derived from `TOKEN_ENCRYPTION_KEY` with HKDF; no new secret |
| `src/tools/_writes.ts` (new, pure) | `canonicalize(batch)` (stable key order, trimmed strings, cents as integers); `mintApproval({ connectionId, email, payloadHash })` HMAC-SHA256, 30-minute expiry, single use; `verifyApproval`; `assertBalanced(entry)` to the cent; `ALLOWED_TXN_TYPES = ["Purchase", "Deposit"]`; `isFundingLine(txn, line)` (the bank or card side is never editable); `applyCategory(txn, line_id, account_id, class_id, department_id, memo)` returns the **full** line array with the one change — a QBO sparse update replaces `Line` wholesale, so every line is sent |
| `src/tools/writes.ts` (new) | `categorize_transactions`: per item `getPurchase` / `getDeposit` → locate the line → refuse funding lines → build `{ Id, SyncToken, sparse: true, Line }` → `updatePurchase` / `updateDeposit`. `create_journal_entries`: `createJournalEntry` with `JournalEntryLineDetail` (`PostingType`, `AccountRef`, `ClassRef`, `DepartmentRef`), `DocNumber`, `PrivateNote`, `TxnDate`. Both: `mode` `dry_run` (default) resolves ids to names via `getAccount` / `findClasses`, returns before → after per item, totals, and the approval token; `commit` verifies the token against the re-canonicalized payload, connection and email, honors `batch_key` idempotency, writes the audit row, executes sequentially, records QBO id and SyncToken before and after per item, and finishes the row. `get_write_log(since, tool?, limit)`. A separate `RateLimiter(30, 60_000)`; 200 items per batch |
| `src/server.ts` | write tools registered only when `env.WRITES_ENABLED` **and** the connection's `writes_enabled` **and** `authorized_by` is set |
| `DEPLOY.md` | how to enable writes on one connection (`set_writes_enabled`) and how to turn them all off (`WRITES_ENABLED=false`) |
| tests | `_writes.test.ts`: canonical form stable across key order and whitespace; token bound to connection, email and hash, expires, single-use; unbalanced entry refused; `Payment` / `Transfer` / `BillPayment` refused by type; funding line refused; the sparse payload carries every line. `writes.test.ts` with a fake `qb`: read-modify-write sends the SyncToken; a SyncToken conflict fails that item and the batch continues; a replayed `batch_key` returns the stored result and posts nothing; dry-run writes an audit row too |

**Sandbox proof (Wed 09-23 → Thu 09-24).** Sandbox project: `WRITES_ENABLED=true`, Google
variables, `set_writes_enabled` on the sandbox company. Categorize three Purchases and one Deposit
dry-run → commit; create two journal entries; check each in the sandbox UI; read them back with
`get_write_log`.

**Production (Fri 09-25 → Wed 09-30).** Deploy with `WRITES_ENABLED=true` and `writes_enabled = 0`
on every connection; Alex enables it on the airCFO connections only. Dress rehearsal 09-28 → 09-30
is **dry-run only** on airCFO: Kim's August worksheet through `categorize_transactions`, Kevin's
prepaid draft through `create_journal_entries`; Kim reads the before → after output once. Commit
mode on real books only after the written go / no-go on Wed 09-30.

**Done when:** both tools commit on the sandbox with complete audit rows; every guardrail has a
failing test that its code makes pass; the airCFO dry-run output exists in `closes/2026-09/` for
Kim; `DEPLOY.md` documents the sandbox and the switches.

## Go / no-go · Wed 09-30

Alex's written call, with Kevin and Justin, per the September plan: which skills run live on 10-02,
**whether write scope is live**, what is measured. Inputs from this workplan: PR 1's 48-hour log
check, PR 3's `login_denied` count, PR 5's sandbox proof and the dress-rehearsal dry-run.

## PR 6 · `feat/read-gaps` (P4) · October, after the close · 1–2 sessions

G8 attachments (`findAttachables` filtered on `AttachableRef.EntityRef`, `getAttachable` with the
temporary download link); G9 recurring templates — not in `node-quickbooks`, so a direct
`GET /v3/company/{realm}/query?query=select * from RecurringTransaction` with the connection's
bearer, verified on the sandbox first; G10 `get_uncleared_transactions(account, as_of)`; G11
`get_uncategorized_activity` over 69999 / 13500 / 49000; G12 `all: true` paging on `search_*` up to
5,000; G13 `format: "csv"` on detail reports.

## P5 · Q4

The Noctopus decision (plan §7); `rippling-mcp` inherits `google-idp.ts`, `access.ts` and the
write-audit pattern; `~/GitHub/MCP_CONSOLIDATION_PLAN.md` row for `qbo-mcp` changes from "Public
(planned)" to "Internal".

## Dependencies and fallbacks

```
P0 ──► PR 1 ──► PR 2 ──► PR 3 ──► PR 5 ──► go/no-go ──► 10-02
                          │
                          └──► PR 4 (parallel; the plugin and registry PRs can land any time after PR 3's design is fixed)
```

- **PR 1 does not end the re-auths** (48-hour check still shows streaks): read `refresh_token_rejected`
  in the logs; if present, a small follow-up PR makes refresh rotation idempotent with a 10-minute
  grace window. Both hypotheses are then measured, not argued.
- **The Google client is not ready** (0.3 slips): PR 1 and PR 2 ship regardless; PR 3 waits; PR 5's
  commit mode is blocked by ruling 4, dry-run is not.
- **PR 5 slips past 09-30:** 10-02 runs dry-run only and Kim posts from the worksheet — the September
  plan's stated fallback. Order of what gives, unchanged: writes first, read gaps second, PR 1 never.
- **Re-auth day goes badly:** the confirmation page and `login_denied` lines say why; the allowlist is
  an env var, fixed in Railway without a deploy.
