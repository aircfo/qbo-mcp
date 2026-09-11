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

## P0 · Before the code — **decided by Alex, 2026-09-10**

| # | Item | Owner | State |
|---|---|---|---|
| 0.1 | Rulings logged in `context/decisions.md` | Claude | **done** 2026-09-10 |
| 0.2 | Identify `aarondras@gmail.com` | Alex | **identified and ruled: notify, then offboard.** Almost certainly **Aaron Drasner, Controller, Union Square Donuts** — HubSpot contact `aaron@unionsquaredonuts.com`, created 2026-06-18, source `asg-webinar`, lifecycle **lead**. Note drafted below; Alex sends it before 09-21 |
| 0.3 | Google OAuth client for qbo-mcp | Alex | **done 2026-09-10.** Production redirect URI only; the Railway sandbox is being sunset, so proving moves to local dev — **one more URI to add, see below** |
| 0.4 | `ALLOWED_USERS` / `ADMIN_USERS` | Alex | **ruled: every airCFO team member**, not the eleven proposed. Expressed as `ALLOWED_USERS=*` — see below for why a sentinel and not a 65-name list |
| 0.4b | Kim's approver identity | Alex | **ruled: Kim gets her own `@aircfo.com` Google account** before 09-21, so the person who reviews a batch is the person who approves it. PR 5's design assumes this |
| 0.5 | Tell the team | Alex | **ruled: Alex posts both messages.** Drafts below, ready to copy |
| 0.6 | Kevin logs re-auth events | Alex → Kevin | **ruled: Alex sends it.** Draft below |

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

**Ruled 2026-09-10: notify, then offboard on the PR 3 date.** He is a controller at a real business
who has been running our connector against his own books for ten weeks and used it today; he is also
an open sales lead. A silent cut-off reads as a broken tool, and it is the worst outcome available
for a lead who has already shown he wants this. An allowlist exception was rejected: it would need a
per-connection bypass of the `@aircfo.com` rule, which is the open front door PR 3 exists to close.

**The note, drafted for Alex to send before 09-21.** Written in the register of his own webinar
follow-ups. Two things it deliberately does *not* do: claim we watched his usage, and point him at
this repo — which goes private in PR 4, so "self-host ours" stops being an actionable answer. Intuit's
own open-source server is the honest self-host path for one person on one company.

> **Subject:** the QuickBooks connector — a heads up
>
> Hi Aaron,
>
> Quick heads up on the QuickBooks connector you picked up after the All Systems Go webinar. We're
> folding it into our own internal tooling, so the hosted version goes airCFO-only on **Monday
> September 22** and will stop connecting after that.
>
> Two options if you want to keep the capability:
>
> Intuit publishes their own open-source MCP server for QuickBooks — it's built for exactly your
> case, one person and one company, running locally:
> https://github.com/intuit/quickbooks-online-mcp-server
>
> Or, if you'd rather not run anything yourself: what you've been doing with it is close to what we
> do for clients every month, and I'd be glad to walk you through how that works. Happy to find
> 20 minutes: https://cal.frontapp.com/aircfo/alex/30min
>
> Either way, thanks for giving it a real run — genuinely useful to see someone use it in anger.
>
> Alex

Two notes on the draft. **The date says Monday September 22**, one day after the deploy, so he is
never cut off before the note's own deadline. **It offers a call, not an apology** — he is a lead,
the tool worked, and the reason it is going away is that it became load-bearing internally.

### 0.3 — the Google OAuth client: created, with one URI still to add

**Created 2026-09-10** in the same Google Cloud project as `aircfo-mcp`, with the production
redirect URI `https://qbo-mcp-production-5667.up.railway.app/oauth/google/callback`.
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` go into the "QBO MCP Server" Railway
project. No scopes beyond the defaults: the gate uses `openid email profile` and reads the verified
`id_token`, never Google data.

**Alex is sunsetting the Railway sandbox service, so its URI was deliberately not added.** That
removes the deployed rehearsal surface both PR 3 and PR 5 were going to use. The replacement is
local development, which this repo is already configured for:

```
PUBLIC_URL=http://localhost:8080
INTUIT_REDIRECT_URI=http://localhost:8080/oauth/intuit/callback
INTUIT_ENVIRONMENT=sandbox
```

`pnpm dev` against an **Intuit sandbox company** is a better write-development target than a hosted
sandbox anyway: no deploy cycle between edits, and a posted entry is inspectable in Intuit's own
sandbox UI. No code changes for it — `INTUIT_ENVIRONMENT=sandbox` already routes to Intuit's sandbox
APIs and the local database is a separate file.

**The one thing to add — a 30-second edit to the client just created:**

```
http://localhost:8080/oauth/google/callback
```

Google allows `http` for `localhost` redirect URIs on a Web application client. Without it the
Google gate cannot be exercised anywhere but production, and PR 5's writes cannot be proven against
any QuickBooks company before they point at real books.

**What local dev cannot rehearse.** Claude Code reaches `http://localhost:8080`; **claude.ai cannot**
— it needs a public HTTPS URL and uses its own redirect (`https://claude.ai/api/mcp/auth_callback`).
81 of the registered clients on this server are claude.ai, so that is how most of the team connects,
and with the sandbox gone that path gets its first real exercise in production. Mitigation, carried
into PR 3's deploy order: **Alex re-authorizes through claude.ai himself immediately after the 09-21
deploy, before the team notice goes out.** Rollback needs no deploy — `ALLOWED_USERS` is an
environment variable — and a genuinely broken gate is one revert away.

### 0.4 — the allowlist: every airCFO team member

**Ruled 2026-09-10:** access is every airCFO team member, not the eleven the evidence named. That
is a broader policy than the proposal and it simplifies the mechanism, because a 65-name list is
worse than no list: it locks out every new hire until someone remembers to edit an environment
variable, and it revokes a departure no faster than switching off their Google account already does.

```
ALLOWED_USERS=*
ALLOWED_DOMAIN=aircfo.com
ADMIN_USERS=alex@aircfo.com,david@aircfo.com
```

`*` means *any* address on `ALLOWED_DOMAIN` whose Google `id_token` says the address is verified.
**It is a sentinel rather than an empty value on purpose:** an empty variable must deny everyone, so
that a variable accidentally cleared fails closed instead of silently opening the server to a whole
domain. Tightening later to a named list needs no code change — set the names and the sentinel is
gone.

What still gates access with `*` set: a Google account on airCFO's Workspace, **and** completing
Intuit consent for the specific company. Nobody reaches a client's ledger by signing in; they reach
it by holding a grant for it. Two admins rather than one so revoking a connection never waits on a
single person.

`aircfo-mcp` keeps an explicit name list, and the difference is deliberate: it holds a domain-wide
Google key that can read any teammate's mailbox, where this server reads a ledger the caller has
already been granted. Same gate, different blast radius.

### 0.4b — Kim gets her own account

**Ruled 2026-09-10: Kim gets her own `@aircfo.com` Google account before 09-21.** Front had no
individual teammate named Kim — `kim@aircfo.com` is the shared "Ops Team" seat — and under rulings 2
and 3 the approver on every write is a verified `@aircfo.com` Google account. Routing approvals
through Kevin or Justin was rejected: it splits the reviewer from the approver at exactly the step
the approval exists for. Dry-run-only for September stays the fallback if the account does not
arrive.

**PR 5 assumes this.** The write path records one approver per batch and refuses a commit from an
unverified identity, so if 09-21 arrives without Kim's account the September close runs dry-run and
she posts from the worksheet as she does today.

### 0.5 — the team notice, drafted

Post once now, and again the day before PR 3 deploys.

> **QuickBooks connector, two changes.**
> **Fixed today.** The connector losing its session after an hour — the one where `/mcp` reconnect
> didn't help and you had to disconnect and re-authenticate — is fixed and deployed. It was our bug:
> the server answered a dead session in a way Claude couldn't recover from. If you still hit it after
> today, tell me the time and I'll read it out of the logs.
> **Coming Mon 09-21.** Sign-in moves to your Google `@aircfo.com` account, and the connector
> becomes airCFO-only — any airCFO address works, no list to be added to. On that day you'll
> re-authorize each client folder once — `/mcp` from the folder, sign in with Google, pick the
> client's company in Intuit as usual. Once. After that the connect page will show you which company
> and which realm you just connected, so a wrong-company grant is visible instead of silent.

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

## PR 3 · `feat/google-identity` — who is calling (P2) · **open as [#16](https://github.com/aircfo/qbo-mcp/pull/16), CI pending; blocked on the Railway variables** (2026-09-10, ahead of the window) · Engineering review

**Closes G5, G7; removes the public connect page.** Copies `aircfo-mcp`'s gate: `src/auth/google-idp.ts`
(`googleAuthUrl`, `verifyGoogleCode` on `google-auth-library`'s `OAuth2Client`, scopes
`openid email profile`, verified `id_token` is the source of truth) and its per-request allowlist
re-check.

| File | Change |
|---|---|
| `package.json` | add `google-auth-library` |
| `src/config/env.ts` | add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (required), `ALLOWED_USERS` (comma list → lowercase array, or the single sentinel `*` meaning any verified address on the domain — **empty denies everyone**, so a cleared variable fails closed), `ALLOWED_DOMAIN` (default `aircfo.com`), `ADMIN_USERS`. Remove `TERMS_URL`, `PRIVACY_URL`, `DOCS_URL`, and the dead `JWT_SIGNING_KEY` from `.env` |
| `src/auth/google-idp.ts` (new) | as in `aircfo-mcp`; redirect URI `${PUBLIC_URL}/oauth/google/callback` |
| `src/auth/access.ts` (new) | `isAllowedUser(email, verified)` = Google says verified, the address ends with `@ALLOWED_DOMAIN`, **and** either `ALLOWED_USERS` is the sentinel `*` or the address is in it; `isAdmin(email)`. Tested for the fail-closed empty case as well as the two allow paths |
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

**Deploy order.** Locally first (`pnpm dev`, the localhost redirect URI from 0.3, `ALLOWED_USERS`
set to two names): confirm a non-listed Google account is refused, an unverified address is refused,
and the confirmation page names the sandbox company and its realm. Then production on a **Monday
morning** (09-21) after the 24 h notice.

Then in this order, because the claude.ai path cannot be rehearsed anywhere else: **Alex
re-authorizes through claude.ai first and confirms it works**, then the notice goes out and everyone
re-runs `/mcp` once per client folder. Watch `login_denied` for the first day. If the gate
misbehaves, widening `ALLOWED_USERS` is an environment-variable change with no deploy; reverting the
merge is the backstop.

**Done when:** a Google account outside the allowlist cannot connect; `connection_status` shows the
teammate's verified email; removing an email from `ALLOWED_USERS` blocks that person's next call
without a redeploy of anything else; `list_connections` shows every row with a company name; the
Gmail user is either allowlisted or refused, per 0.2.

**As built** (2026-09-10). One departure, recorded in `decisions.md`: the identity column is `email`
plus an `email_verified` flag, not a second `authorized_by` column. Less to keep consistent, and it
leaves `reconcileConnection`'s (realm, email) key untouched — which is what makes the one-time
re-authorization *fold onto* the row it upgrades instead of adding a fourteenth row for Alex.
Added beyond the list: the five connect-flow pages consolidated into one module, and `purgeExpired`
given an injectable clock so its behaviour is exactly testable (the `RateLimiter` convention).

**Hard precondition before merge.** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`ALLOWED_USERS`, `ALLOWED_DOMAIN` and `ADMIN_USERS` must exist in the "QBO MCP Server" Railway
variables first. Boot-time validation exits without them, so the deploy fails its healthcheck —
safely, since Railway keeps the previous version running, but it fails.

## PR 3a · `fix/revoke-the-right-token` — the hotfix PR 3 needed · **open as [#17](https://github.com/aircfo/qbo-mcp/pull/17), CI green** (2026-09-10)

PR 3's first real use, on production, produced a connection that was already dead: Intuit answered
`401 AuthenticationFailed, errorCode 3200` seconds after a successful exchange, and the confirmation
page read `(name unavailable)` because its CompanyInfo lookup was the first call to hit it.

`OAuthClient.revoke(params)` reads `params.access_token || params.refresh_token || <its own current
token>`. Our wrapper passed `{ token }`, which it ignores, so every revoke fell through to the
client's own token — and that client is a singleton whose state was last written by `createToken`. A
re-authorization revoked the access token it had just minted. Full reasoning in `decisions.md`.

Fixed by naming the parameter, removing the revoke from `reconcileConnection` entirely, and guarding
the cancel path so it only revokes a connection it created. Revocation now works for the first time
on this server, which also closes the half of G4 that observed old Intuit grants staying live.

**What this says about the verification step.** The deploy was checked from outside and the database
was read, but nothing asked *Intuit* whether the stored credentials still worked — and the answer
was sitting in the logs as `company_name_lookup_failed`. Every future connect-flow change gets one
more check before it is called done:

```sh
railway logs -n 200 --json -f 'company_name_lookup_failed OR qbo_upstream_error OR access_refused'
```

and, for a change that touches credentials, a direct call to Intuit with a stored token
(`context/prod-query.js` is the pattern; print statuses, never tokens).

**Named follow-up, not yet scheduled.** `QboClientManager` refreshes on expiry only, so an access
token Intuit invalidates early keeps failing for up to an hour instead of triggering one
refresh-and-retry. It would have softened this incident and would also have hidden the bug. Small,
self-contained, and worth doing before the September close — fold into PR 6 or take it alone.

## PR 4 · `chore/teardown` + two sibling PRs — the public surface (P2) · Thu 09-17 → Fri 09-18, parallel to PR 3 · ½ session each

**Closes G15 (visibility) and the plan's §5.**

| Where | Change |
|---|---|
| GitHub settings (Alex) | `gh repo edit aircfo/qbo-mcp --visibility private --accept-visibility-change-consequences`; disable Pages (`gh api -X DELETE repos/aircfo/qbo-mcp/pages`) |
| `docs/` | delete the Jekyll site. The getting-started content that still applies to teammates moves into `README.md` |
| `README.md` | rewrite for the internal posture: what it is, who may use it (allowlist), how to connect from a client folder, the identity check with the realm, the read tools, the write tools and their approval flow (PR 5), the admin tools, operations. Keep the Intuit OSS attribution and `LICENSE` |
| `SECURITY.md` | rewrite: team identity, write controls, the audit table, what the tool can do to a client's books and who can do it, incident response (rotate `TOKEN_ENCRYPTION_KEY`, revoke, notify). Drop the "going public" checklist and the `docs/security-details.md` sync note |
| `DEPLOY.md` | the Google client setup and the new variables, plus a **Local sandbox development** section in place of a Railway-sandbox one: `pnpm dev` with `INTUIT_ENVIRONMENT=sandbox`, an Intuit sandbox company, and the localhost redirect URIs. The "QBO MCP (Sandbox)" Railway project is being sunset (Alex, 2026-09-10) and must not be documented as a target |
| `context/intuit-launch-requirements.md` | one line at the top: superseded by the internal decision; kept for the pricing facts |
| `aircfo/claude-startup-finance` (sibling PR) | remove the hosted URL from `plugins/finance-contextos/.mcp.json`; `CHANGELOG`; version 0.9.1. The context-builder skill already degrades without the connector. **The README cannot say "self-host `qbo-mcp`" any more:** rows 64, 157 and the `finance-contextos` README both link `github.com/aircfo/qbo-mcp`, which goes private in this same PR, so a public plugin would point the world at a 404. Point at [`intuit/quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server) instead — MIT, single-user, single-company, which is what a plugin user actually wants — or drop the QuickBooks connector from the plugin entirely. **Alex's call; not decided yet.** The same substitution is already in Aaron's note |
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

**Sandbox proof (Wed 09-23 → Thu 09-24).** Locally: `WRITES_ENABLED=true`, the Google variables,
`set_writes_enabled` on a connected Intuit sandbox company. Categorize three Purchases and one
Deposit dry-run → commit; create two journal entries; check each in Intuit's sandbox UI; read them
back with `get_write_log`. Then exercise three guardrails by hand as well as in tests: a stale
approval token, a batch edited after approval, and a replayed `batch_key`.

**Consequence for the bookkeeping repo:** the September plan's addendum point 4 says "the sandbox QBO
connector is for writes only and is not in the repo". After the sunset that is stale — there is no
sandbox connector to point Kevin at. PR 4's sibling PR should say write development happens locally
and Kevin's read-only runs stay on production.

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
- **The localhost redirect URI is not added:** PR 3 still ships, since its logic is unit-tested, but
  its first real exercise becomes production on 09-21 and PR 5's writes cannot be proven against any
  QuickBooks company before pointing at airCFO's real books. The one dependency worth chasing, and a
  30-second edit to a client that already exists.
- **PR 5 slips past 09-30:** 10-02 runs dry-run only and Kim posts from the worksheet — the September
  plan's stated fallback. Order of what gives, unchanged: writes first, read gaps second, PR 1 never.
- **Re-auth day goes badly:** the confirmation page and `login_denied` lines say why; the allowlist is
  an env var, fixed in Railway without a deploy.
- **Kim's Google account does not arrive by 09-21:** September runs dry-run and she posts from the
  worksheet, as the September plan already provides for. Nothing else in PR 5 changes — the approver
  check is the same code either way.
