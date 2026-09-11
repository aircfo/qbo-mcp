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

## 2026-08-05 — Public user guide via GitHub Pages; honest connect-page assurances

Preparing for external consumption (pushing non-airCFO users toward the tool):

- **User guide published from `docs/` via GitHub Pages** (just-the-docs theme,
  `aircfo.github.io/qbo-mcp`). The repo stays private; only the rendered site is
  public. `SECURITY.md` is published verbatim as a page (`docs/security-details.md`,
  manual copy — sync note at the top of `SECURITY.md`) because the honest
  threat-model writeup is itself a trust signal.
- **Connect-page assurance wording is deliberately scoped to "through this
  tool."** We say airCFO *cannot view your books through this tool* (true: tool
  access is bound to the user's own Claude connection) — NOT "airCFO can never
  access your data" (false: we custody encrypted tokens on our infrastructure,
  disclosed in the trust docs). Keep any future marketing copy inside that line.
- **Bare server root now redirects to the user guide** (`DOCS_URL` env, defaults
  to the Pages URL) so pasting the connector URL into a browser lands somewhere
  legit instead of a 404.

## 2026-09-10 — qbo-mcp becomes airCFO's internal ledger connector (Alex)

The server was built and hardened as a public, read-only tool for outside founders. It is now
the QuickBooks connector for airCFO's bookkeeping automation (`~/GitHub/bookkeeping-automation`),
which needs writes by the 2026-10-02 mapping day. Production evidence read the same day: 37
connections since May, 9 people, 8 on @aircfo.com; teammates already connect client companies.

**Decision (seven rulings, all confirmed):**

1. **Internal-only.** Repo private, GitHub Pages down, the public plugin stops pointing at this
   deployment, outsider-facing connect-page promises removed.
2. **Identity is Google sign-in on @aircfo.com with an allowlist**, the `aircfo-mcp` pattern.
   The self-reported email goes away; the allowlist is re-checked on every request.
3. **Write scope v1 is two tools:** re-categorize existing Purchase/Deposit transactions and
   create journal entries. Dry-run by default; commit requires an approval token minted from the
   exact approved batch; every write logged with its verified approver; entity allowlist in code;
   nothing that creates, pays or moves cash.
4. **Commit mode waits for verified identity** — the Google gate ships before writes. If the
   gate slips, writes ship dry-run-only and Kim posts from the worksheet on 10-02.
5. **Per-person Intuit grants stay**; no shared team token per realm.
6. **Same repo, same deployment URL, through October.** The Noctopus question is decided in Q4,
   after client #2. Grants and every client folder are keyed by the URL.
7. **The one non-airCFO address in production** (a Gmail user of one client company since June)
   is identified by Alex; if unknown by 2026-09-16 it gets a one-line notice before the gate
   closes.

**Why not keep it public:** no outside demand appeared in three months (zero beta requests, one
webinar follow-up), while the internal use grew to nine people and six client companies, and the
public design (unverified email, open registration, read-only) blocks the write path the close
needs. Reversibility: the server keeps running throughout; only who may sign in changes.

Proposal and evidence: `context/internal-conversion-plan.md`. Execution:
`context/internal-conversion-workplan.md`. Root cause of the hourly re-auth defect (key question
#52 in bookkeeping-automation): evicted sessions were answered 400 instead of 404, so clients
never re-initialized — measured at 31% of production requests.

## 2026-09-10 — A repeat authorization reuses its connection row, and never replaces it

Until now every completed Intuit authorization inserted a row, so re-authorizing
the same company left the previous row behind still holding credentials that
Intuit keeps live for 100 days. Combined with the hourly session defect — which
made people re-authorize constantly — one person accumulated **thirteen rows for
one company**, and the production table reached 37 rows for 9 people.

**Decision:** `reconcileConnection` (`src/auth/connection-reconcile.ts`) folds a
repeat authorization onto the most recent row for that (realm, email) pair.
Three details are the decision, not the implementation:

1. **Reuse the row, keep its id — never delete and re-create.** One person
   legitimately runs several MCP clients against the same company (claude.ai
   plus a Claude Code client per client folder), and each holds a downstream
   token that resolves to this connection id. Reusing the row keeps all of them
   working; replacing it would break every client except the one that just
   authorized. The live table shows exactly this: two of Alex's connections to
   airCFO's realm belong to different clients and are both in use.
2. **Keying on the self-reported email is sound, even unverified.** Reaching
   this code means Intuit consent for that exact company succeeded, so a caller
   who types someone else's address gains nothing they had not already proved.
   The key becomes a verified Google identity when sign-in moves to
   `@aircfo.com` accounts, and this design does not depend on that.
3. **Do not revoke a refresh token identical to the new one.** Revoking a
   refresh token also invalidates its access tokens, so revoking a value Intuit
   just reissued would destroy the connection being established. Guarded and
   tested.

Existing orphan rows are left alone: cleaning them up needs the admin
`revoke_connection` tool that arrives with the identity gate. `findByRealmAndEmail`
breaks a `created_at` tie on `rowid`, because the column is millisecond-resolution
and SQLite does not otherwise return the later row.

**Also decided here:** `connection_status` exists as a tool that answers "which
company am I bound to" **without calling QuickBooks**. The identity check in
the bookkeeping repo needed a fallback when the entity endpoints returned 504
five times running, and improvised one by comparing account ids to a stored
fingerprint. A tool that reads only our own database is the better fallback.

## 2026-09-10 — Access is every airCFO team member, expressed as a sentinel (Alex)

**Decision:** `ALLOWED_USERS=*` with `ALLOWED_DOMAIN=aircfo.com` — any address on airCFO's Google
Workspace whose `id_token` reports it verified. Not the eleven-name list the production table and
the September plan implied.

**Why a sentinel and not a list of 65 names.** A name list is worse than no list at this breadth: it
locks out every new hire until someone edits an environment variable, and it revokes a departure no
faster than disabling their Google account already does. `*` also keeps the tightening path open —
set names and the sentinel is simply gone, no code change.

**Why `*` and not "empty means everyone".** An empty variable must deny everyone. If empty meant
"any domain member", a variable accidentally cleared during a deploy would silently open the server
to a whole domain; with the sentinel it locks everyone out instead, which is the failure worth
having. Fail closed on misconfiguration, open only on a deliberate, visible value.

**What still gates a client's ledger.** Signing in proves who you are; it grants nothing. Reaching a
company's books additionally requires completing Intuit consent for that company, and each grant is
its own stored credential. This is why the broader policy is acceptable here while `aircfo-mcp`
keeps an explicit list: that server holds a domain-wide Google key able to read any teammate's
mailbox, where this one reads a ledger the caller was already granted. Same gate, different blast
radius.

**Also ruled the same day:** Kim gets her own `@aircfo.com` Google account before 2026-09-21, so the
person who reviews a batch of writes is the person who approves it. Routing her approvals through
Kevin or Justin was rejected for splitting reviewer from approver at exactly the step the approval
exists for; dry-run-only for September remains the fallback if the account does not arrive.


## 2026-09-10 — Identity is Google, established before Intuit and re-checked every request

**Decision:** the connect flow becomes Google → Intuit → confirm, and the public
connect page is deleted.

1. **Google first, Intuit second.** `provider.authorize` parks the MCP
   authorization and redirects to Google; `/oauth/google/callback` verifies the
   signed `id_token`, applies the domain and allowlist gate, and only then
   forwards to Intuit. An address we do not admit never reaches QuickBooks at
   all. The old flow asked for an email on a form and believed the answer.
2. **Each leg gets its own single-use state.** The Google state is consumed at
   its callback and a *new* state is minted for Intuit with the verified address
   attached, so the Google leg cannot be replayed into a second Intuit consent.
3. **The gate runs on every request, not just at sign-in.** `verifyAccessToken`
   loads the connection and re-applies the allowlist, so removing someone ends
   their access on their next call rather than whenever their token expires.
   A connection made before the gate has no verified address and is refused
   there — that is the one-time re-authorization, and it is deliberately not
   skippable.
4. **A confirmation step before the authorization code.** Intuit's company
   picker decides which company a grant covers and this server has no say in it,
   so connecting the wrong company was silent. The person now sees the company
   name and realm and must confirm; declining revokes the grant. A connection
   the flow *created* is deleted on cancel, one it merely refreshed is not —
   that row belongs to connections the person already had.
5. **`email_verified` rather than a second address column.** The plan called for
   an `authorized_by` column beside `email`. One address column plus a verified
   flag is less to keep consistent, and it leaves `reconcileConnection`'s
   (realm, email) key untouched — so the one-time re-authorization *folds onto*
   the row it upgrades instead of creating another.
6. **Domain-wide by a visible sentinel.** `ALLOWED_USERS=*` admits any verified
   address on `ALLOWED_DOMAIN`; an empty value admits nobody. See the access
   decision logged the same day for why the failure mode points that way.

**Administrative tools** (`list_connections`, `revoke_connection`,
`set_writes_enabled`) are registered only for sessions whose verified address is
in `ADMIN_USERS`, so they are absent from other tool lists rather than present
and refusing. They close the "no admin-initiated revocation" limitation
`SECURITY.md` carried, and they are what will clean up the orphan rows that
predate the reconcile change.

**Also:** expired `oauth_tokens` rows are swept hourly with a week of grace.
Nothing pruned them before, so the table held 923 access tokens for 37
connections.

## 2026-09-10 — Revocation: name the token, and only revoke when ending access is the intent

**The incident.** The first real re-authorization through the new identity gate
produced a connection that was already dead: Intuit answered
`401 AuthenticationFailed, errorCode 3200` seconds after a successful token
exchange, and the confirmation page showed "(name unavailable)" because its
CompanyInfo lookup was the first call to hit it.

**Root cause, and it is one line.** `OAuthClient.revoke(params)` reads
`params.access_token || params.refresh_token || <the client's own current
token>`. Our wrapper called `this.oauth.revoke({ token })` — a key the library
ignores. So every revoke fell through to the client's own token, and that client
is a long-lived singleton whose token state was last written by `createToken`.
A re-authorization therefore revoked **the access token it had just minted**.

Two things follow from the same bug. Revocation has never actually worked on
this server: `disconnect_quickbooks` hit the same fallback with an empty token
state, which is part of why G4 observed old Intuit grants staying live for 100
days. And the failure only became visible now because nothing used to make a
QuickBooks call immediately after connecting.

**Decisions.**

1. **`IntuitOAuth.revoke` passes `{ refresh_token }`.** `IntuitOAuth` now takes
   its client by constructor injection so the parameter name is covered by a
   test rather than by care.
2. **`reconcileConnection` revokes nothing.** The superseded refresh token and
   the one Intuit just issued belong to the same authorization — same app,
   company and person — and Intuit's revoke ends the authorization, not an
   individual token. So revoking the old one risks taking the new one with it,
   and the old one is superseded regardless. The function is now synchronous,
   which is a fair signal that it does no I/O.
3. **Cancelling only revokes a connection this flow created.** Cancel used to
   revoke unconditionally, which for a *reused* row would have ended an
   authorization shared with that person's other MCP clients.
4. **Revocation stays where ending access is the intent:**
   `disconnect_quickbooks`, the administrative `revoke_connection`, and
   cancelling a newly created connection — and it works now.

**Known follow-up, not taken here.** `QboClientManager` refreshes on expiry
only, so a stored access token that Intuit has invalidated early keeps failing
for up to an hour instead of triggering one refresh-and-retry. That would have
softened this incident, and it is worth doing, but it would also have hidden the
bug; it belongs in its own change.
