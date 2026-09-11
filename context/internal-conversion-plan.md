# Plan — qbo-mcp becomes airCFO's internal ledger connector

**Written:** 2026-09-10 · **Status:** **ruled 2026-09-10 — all seven rulings in §2 confirmed by Alex**; execution
is in `internal-conversion-workplan.md`, the decision is logged in `decisions.md` · **Governs:** the
QuickBooks MCP server (`aircfo/qbo-mcp`, Railway project "QBO MCP Server") from 2026-09-14 through
the September close and into October · **Companion:** `~/GitHub/bookkeeping-automation/firm/history/plan-2026-09-08-september.md`
(the close calendar this plan has to serve) and `~/GitHub/MCP_CONSOLIDATION_PLAN.md` (the 2026-06-15
direction this plan revises for one server).

## 0. In one paragraph

The server was built and hardened as a public, read-only tool for outside founders. It has become the
ledger connector for airCFO's own bookkeeping automation, and the September plan asks it for one thing
the public design deliberately excluded: writes. One address outside @aircfo.com has used it since June and was active on 2026-09-10; everyone
else is the team (§1).
So: retire the public surface, replace self-reported email with verified @aircfo.com identity, fix the
one reliability defect that makes unattended runs impossible (the hourly re-auth, key question #52),
and add a narrow, audited write path — categorization updates and journal-entry creation, dry-run by
default, one approval per batch. Read-side gaps the diagnostics found (realm id, attachments, recurring
templates, uncleared items) follow in October. Keep the deployment URL and the standalone repo through
the close; decide the Noctopus question afterwards.

## 1. Is anyone outside airCFO using it? What was checked on 2026-09-10

| Source | Finding |
|---|---|
| Production server | Up (`/health` 200); OAuth discovery public; dynamic client registration open — anyone with the URL can still register and connect |
| Production database and logs (Railway volume `/data/qbo-mcp.db`; deploy logs since 2026-08-13) | **Read 2026-09-10.** 37 connections over the life of the service, 9 distinct emails, 9 distinct QuickBooks companies. Since the 08-13 deploy: 29 connect attempts, 13 connections created, 3,837 MCP requests, 738 of them tool calls. **Eight of the nine emails are @aircfo.com** (alex 13 rows, david 8, johannes 5, romicca, kevin, kettia, aivic 1 each; 2 rows predate email capture). **The ninth is `aarondras@gmail.com`:** 5 connections since 2026-06-29, all to realm 719325880, 75 tool calls since 08-27 (chart of accounts, balance sheet, P&L, general ledger), token refreshed 2026-09-10 17:21 UTC — in use today, through the claude.ai connector. Teammates are already connecting client companies, not just airCFO: six client realms appear |
| GitHub repo `aircfo/qbo-mcp` | **Public** (the 2026-08-05 decision note says "the repo stays private" — it is not). 0 stars, 0 forks, 0 watchers, 0 issues. Last 14 days: 1 page view (1 unique), 4 clones (4 unique — consistent with scanners or our own tooling, not adopters) |
| GitHub Pages user guide (`aircfo.github.io/qbo-mcp`) | Live. Home page and Getting Started advertise a "gated beta" with a *Request beta access* mailto |
| Inbox (`alex@aircfo.com`, last 120 days) | Zero beta-access requests. One outside person asked for the tool after the June webinar (Anthro Energy, June 23 – July 15 thread) and was sent the *Claude for Startup Finance* plugin on 2026-07-15. Whether she ever connected is only visible in the production database |
| Public plugin `aircfo/claude-startup-finance` (1 star, 1 fork) | `plugins/finance-contextos/.mcp.json` hard-codes the production URL as `aircfo-quickbooks`; the README says the connector "runs on airCFO infrastructure by default; self-host it if you'd rather". This is the only public distribution channel |
| Local dev database | 1 sandbox connection from 2026-05-27; dev only |

**Reading:** the tool is internal in practice already — nine people, eight of them airCFO, working airCFO's
books and six client companies. The one open item is `aarondras@gmail.com`: if Alex recognizes the address
(a teammate on a personal account, or a client contact), it goes on the allowlist or is asked to use an
@aircfo.com login; if not, it is the only outside user and deserves a note before the Google gate cuts
them off. Every teardown step in §5 is reversible for a week (the server keeps running; only who may log
in changes).

## 2. Rulings — confirmed by Alex, 2026-09-10

1. **Internal-only, confirmed.** Consequences accepted: repo goes private, Pages comes down, the
   public plugin stops pointing at our deployment, the connect-page promises written for outsiders
   ("airCFO cannot view your books through this tool") are removed because they stop being true.
2. **Identity = Google sign-in, @aircfo.com, allowlist** — the pattern `aircfo-mcp` already runs
   (`src/auth/google-idp.ts`, `google-login.ts`, `caller.ts`, `ALLOWED_USERS`). Recommended over
   keeping the unverified email: a write must carry a name someone can be held to.
3. **Write scope v1 is exactly two tools** — re-categorize existing bank/card transactions
   (Purchase and Deposit line accounts) and create journal entries. Nothing that creates, pays or
   moves cash. Dry-run default; commit requires an approval token minted by the dry-run; every
   write logged with the verified approver. (Firm ruling 2026-08-28 #2 and the vision page.)
4. **Commit mode waits for verified identity.** Sequencing consequence of 2 + 3: the Google gate
   lands the week of 09-14, writes the week of 09-21. If the gate slips, writes ship dry-run-only and
   Kim posts from the worksheet on 10-02, exactly as the September plan's fallback says.
5. **Per-person Intuit grants stay** (today's model: each teammate authorizes each client folder,
   each grant is its own encrypted token set). Rejected: one shared team token per realm — it removes
   Intuit-side attribution and creates a secret to hand around. Claude Code already keys grants by
   (server name, URL), so this costs nothing.
6. **Standalone repo and the same URL through October.** The URL is baked into
   `connectors/registry.json`, every `clients/<slug>/.mcp.json`, the claude.ai connector and every
   teammate's grant; changing it mid-close forces everyone to re-authorize everything. Revisit the
   Noctopus fold (§7) after client #2 is onboarded.
7. **Who is `aarondras@gmail.com`?** The only non-airCFO address in the production table, connected to realm
   719325880 five times since June and active today. Allowlist, ask for an @aircfo.com login, or notify
   before P2 closes the door.

## 3. What the bookkeeping buildout found — the gap list, sourced

Every row cites where the gap was recorded in `bookkeeping-automation`.

| # | Gap | Where recorded | Root cause in this repo | Fix (phase) |
|---|---|---|---|---|
| G1 | **Session expires within the hour; `/mcp` reconnect does not restore it; disconnect + re-auth is the only cure.** Seen 3× on 09-04, first logged 08-02. "The difference between a close skill that runs unattended and one that needs a person watching it" | `key-questions.md` #52; `registry.json` authRunbook; `skills/categorize` *Toward v1* | **Measured in production logs (2026-09-10):** 1,207 of 3,837 requests since 08-13 answered **400** (31%). The MCP spec says a server answers a vanished session with **404**, and the SDK client re-initializes only on 404. This server evicts idle sessions after 30 min (`transport.ts` `SESSION_IDLE_MS`), and for any session id it no longer holds it builds a *fresh* transport and hands it the request; the SDK's `validateSession` then returns `400 Bad Request: Server not initialized` (`webStandardStreamableHttp.js` line 590) before its own 404 branch can run. Claude Code recovers from that 400 at startup but not mid-session: tool calls keep hitting the dead session until the person disconnects and re-authenticates. Three of the longest 400 streaks end exactly that way — 14 straight on 09-03 18:41 (Alex re-auths 18:44), 16 straight over 21 min on 09-04 17:58–18:19 (re-auths 18:22), 43 straight over 2.5 h on 09-06 (the outside user re-auths 00:29). The rotate-and-destroy refresh path (`oauth-store.ts`) may add a second, rarer failure; nothing logs token-endpoint outcomes today, so it is unverified | **P1.** Answer **404** for any request carrying a session id the server does not hold (POST, GET, DELETE) so the client re-initializes transparently; raise idle eviction from 30 min to 8 h; log `invalid_grant` at `/token` so the refresh hypothesis can be measured; then, if it shows up, idempotent refresh rotation with a grace window
| G2 | **Entity endpoints 504 five for five** (`get_company_info`, `search_journal_entries`) while report endpoints worked | `handoff-2026-09-03-bootstrap.md` §7; CHANGELOG 734; registry fallback | `node-quickbooks` sets no request timeout and never retries; the server forwards whatever Intuit or the proxy returns. **In the logs:** four calls on 2026-09-02 01:28–02:00 UTC ran 125.3–126.0 s and were logged 200 by this server — Railway's edge had already returned 504 to the client. Otherwise p99 is 2.1 s | **P1.** Upstream timeout (60 s), retry with backoff on 429/5xx, Intuit fault code + message in the tool error
| G3 | **`get_company_info` does not return the realm id**, so the identity check compares names and stores the realm by hand in the README | `registry.json` identityCheck; 02c step 1; playbook 01 | `runQbo` has `realmId` in hand and drops it | **P1.** Return `realmId`, `environment`, `authorizedBy`, `connectedAt`; new `connection_status` tool |
| G4 | **Every re-auth creates a new connection row**; the old row's Intuit tokens stay live at Intuit for 100 days | consequence of G1 (not recorded there) | `intuit-callback.ts` always `create`s; nothing dedupes on (realm, user) | **P1.** On connect for an existing (realm, authorizedBy): revoke the old Intuit token, replace the row |
| G5 | **Wrong-company binding is silent.** The Intuit picker decides the realm; the server accepts whatever comes back | firm/decisions 2026-08-28 (no business picker entry); playbook 01 identity table | Connect flow never shows what was connected | **P2.** Post-consent confirmation page: "You connected *CompanyName* (realm N) as *you@aircfo.com*" with a cancel that revokes. Plus G3 makes the mechanical check possible |
| G6 | **No write path.** September asks for categorization imports by 10-02; JE posting next | `plan-2026-09-08-september.md` addendum 3; `skills/*` gates; firm/decisions 2026-08-28 #2; `vision.html` | v1 was read-only by design | **P3.** §4 |
| G7 | **Approver identity is a self-reported, unverified email** | SECURITY.md limitations; `connect-page.ts` | Public-tool design choice | **P2.** Google gate; identity on every log line and audit row |
| G8 | **Receipts / attachments not exposed** — the ≥ $75 receipt rule (S1) cannot be machine-checked | `diagnostic-2026-08-30.md` §blind spots; `-09-03.md`; `thresholds.md` row; `automation-plan.md` 58 | No Attachable tools | **P4.** `search_attachments` (by transaction id/type, date) + `get_attachment` (metadata, temp URL) — read-only |
| G9 | **Recurring templates can't be read**; the JE audit infers template firings from posted entries and DocNumber collisions | `diagnostic-2026-08-30.md` Info row; `skills/journal-entries` templates 159/199/135/43, #62 | No RecurringTransaction tools | **P4.** `search_recurring_transactions` / `get_recurring_transaction` |
| G10 | **"Uncleared items not readable; the connector exposes no reconciliation report"** | `skills/reconcile` measure table | Half true: QBO has no reconciliation report via API, but `get_transaction_list` already accepts `cleared` (Cleared / Uncleared / Reconciled). Undocumented for this use | **P4.** `get_uncleared_transactions(account, as_of)` convenience; tool description fixed now |
| G11 | **Bank-feed *For Review* items** are wanted as the live queue | `key-questions.md` #30 | The public Accounting API does not expose the feed. Permanent | Document as a hard limit. Optional `get_uncategorized_activity` over 69999 / 13500 / 49000 (a filtered GL pull) |
| G12 | `search_vendors` capped at 1,000 rows silently missed 43 payees | CHANGELOG 223 | QBO's query max is 1,000; the envelope says `truncated` but the model missed it | **P4.** `all: true` server-side paging up to 5,000 |
| G13 | A month of GL (280–430 KB) exceeds the inline cap; only Claude Code spills it to a file | handoff §7; 02c | JSON arrays are the smallest shape today | **P4.** `format: "csv"` on detail reports |
| G14 | Parameter traps: `get_balance_sheet` with only `end_date` silently returns today; `account_type` must be CamelCase or QBO 400s | 02c tools table; `decisions.md` 226 | Params pass through verbatim | **P1.** Validate: require both dates or derive `start_date`; `account_type` as an enum of the 15 values |
| G15 | **Repo is public while docs say private**; `JWT_SIGNING_KEY` unused; `company_name` column never populated; nothing prunes `oauth_tokens` (923 access-token rows, 109 registered clients, one live refresh token per connection) | `gh repo view`; `MCP_CONSOLIDATION_PLAN.md` Phase 1; production table | Drift | **P2 / P5.** Private; drop the env var; populate `company_name` at connect (it feeds the admin list); nightly sweep of expired token rows
| G16 | No CI in this repo; local Node 26 breaks `better-sqlite3` tests | tree (`.github/` absent); memory | — | **P1.** GitHub Actions on Node 22: typecheck + test |

## 4. The write path, designed

**Tools (v1).**

- `categorize_transactions` — batch of `{ txn_id, txn_type: "Purchase" | "Deposit", line_id?, account_id, class_id?, department_id?, memo? }`. Read-modify-write with QBO's `SyncToken` (optimistic concurrency); sparse update of the offset line only. **Never** touches the rail side (bank / card account), amount, date, payee or payment type.
- `create_journal_entries` — batch of `{ txn_date, doc_number?, private_note?, lines: [{ account_id, debit | credit, description?, class_id?, department_id?, entity? }] }`. Server checks every entry balances to the cent before dry-run returns.
- Both take `mode: "dry_run" | "commit"` (default `dry_run`) and, for commit, `approval_token`.

**Guardrails, in the order a request meets them.**

1. **Kill switch.** `WRITES_ENABLED=false` in env hides the write tools entirely.
2. **Per-connection enablement.** `connections.writes_enabled` (admin-set, default off). airCFO's realm 793988035 first; a client realm only when its AM's folder is signed.
3. **Verified approver.** The access token carries the Google-verified email; a self-reported one is refused (`mode: commit` returns *identity required*).
4. **Entity allowlist, hard-coded.** Purchase and Deposit updates; JournalEntry creates. No Payment, BillPayment, Transfer, Check, SalesReceipt, no deletes, no voids. The firm's no-cash-movement line is enforced in code, not policy.
5. **Dry-run first.** Dry-run resolves ids to names (account, class, vendor), shows before → after per item, totals the batch, and returns an `approval_token` = HMAC over the canonical batch payload, single-use, 30-minute expiry, bound to the connection and the approver. Commit re-canonicalizes the payload and refuses on mismatch — what was approved is what posts, byte for byte.
6. **Batch limits.** 200 items per batch; per-connection write rate limit separate from reads.
7. **Audit log.** New table `write_audit`: id, connection_id, realm_id, approver_email, tool, mode, payload_hash, item_count, per-item `{ qbo_id, sync_token_before, sync_token_after, status, fault }`, started/finished. Written on dry-run *and* commit. Read back with `get_write_log(since, tool?)`. Nothing financial beyond ids and account names is stored.
8. **Idempotency.** Commit accepts a client-supplied `batch_key`; a retry with the same key returns the original result instead of posting twice.

**Where it is built and proven.** **Locally, against an Intuit sandbox company** — `pnpm dev` with `INTUIT_ENVIRONMENT=sandbox`, which this repo is already configured for. The Railway "QBO MCP (Sandbox)" project is being sunset (Alex, 2026-09-10), so there is no deployed non-production target; local dev is the better one regardless, because a write can be edited, re-run and then inspected in Intuit's sandbox UI with no deploy in between. It needs one addition to the Google OAuth client: a `http://localhost:8080/oauth/google/callback` redirect URI. Dress rehearsal 09-28→09-30: commit locally against the sandbox company, dry-run against airCFO production, Kim reads the dry-run output once before the close. The September plan's "the sandbox QBO connector is for writes only and is not in the repo" goes stale with the sunset and is corrected in PR 4's sibling PR.

**Cost note.** Under Intuit's 2026 program, writes ("Core") are unmetered; reads ("CorePlus") draw from the 500k/month Builder pool. Internal volume — a 02c diagnostic is ~30 calls, a close a few hundred — is far inside it (`intuit-launch-requirements.md`).

## 5. Public surface: what comes down, what stays

| Item | Action | When |
|---|---|---|
| GitHub Pages site | Disable Pages (Settings → Pages → None) or replace `docs/` with the internal runbook. The beta CTA goes first | P2, same day as the Google gate |
| Repo visibility | Private. Keep `LICENSE` and the Intuit OSS attribution (MIT terms still apply to the harvested code) | P2 |
| `claude-startup-finance` plugin | Remove the hosted URL from `finance-contextos/.mcp.json`; README rows 64 and 157 become "self-host `qbo-mcp`" only, or the connector is dropped from the plugin. Separate PR in that repo | P2 |
| Connect page | Replace email + acknowledgment with Google sign-in. Delete the assurances block and `TERMS_URL` / `PRIVACY_URL`. Post-consent confirmation page (G5) | P2 |
| `README.md`, `SECURITY.md`, `docs/security-details.md` | Rewrite for the internal posture: team identity, write controls, audit, what the tool can now do to a client's books and who can do it. Drop the "going public" checklist | P2 |
| Intuit developer app | Nothing changes: production keys, self-attested questionnaire, not listed, far under 500 connections | — |
| The claude.ai connector "airCFO's Custom QBO MCP" | Keeps working for allowlisted users (same deployment). Remains airCFO-internal-only per `clients/aircfo/README.md` | — |
| Known outside recipient | Alex's call: a one-line note that the hosted connector is now internal, or nothing | P2 |
| Rate limits, session eviction, size caps | Keep. They were built as abuse controls; they are now runaway-agent controls | — |

## 6. Phases and calendar (against the September plan)

Sizes are Claude Code sessions. P1 and P2 unblock Kevin's read-only runs; P3 is the third build the
addendum warns about; P4 is October.

| Phase | Ships | Serves | Size | Window |
|---|---|---|---|---|
| **P0 · Rulings** | §2 answered; production table read (done 2026-09-10, §8); this plan's rulings logged in `context/decisions.md` | everything | ½ | Fri 09-11 |
| **P1 · Unattended reads** | G1 refresh grace + 12 h TTL · G2 timeout/retry/fault detail · G3 realm + `connection_status` · G4 dedupe on re-auth · G14 param guards · G16 CI on Node 22 · `invalid_grant` logging | Kevin's August dress-rehearsal runs; the 02c identity check; every skill's "resumes when the session dies" requirement | 1–2 | Mon 09-14 → Wed 09-16 |
| **P2 · Internal identity + teardown** | Google @aircfo.com gate with `ALLOWED_USERS` (copied from `aircfo-mcp`) · `authorized_by` on connections · admin `list_connections` / `revoke_connection` · G5 confirmation page · `writes_enabled` flag · §5 teardown · docs rewrite | Approver identity for P3; closes the open front door | 1–2 | Thu 09-17 → Tue 09-22 |
| **P3 · Writes** | §4: `categorize_transactions`, `create_journal_entries`, approval tokens, `write_audit`, `get_write_log`, local sandbox development documented, tests for every guardrail | 10-02 mapping day (imports); JE drafts posted by Claude once Kim's tolerance is written | 2–3 | Wed 09-23 → Mon 09-28 (dress rehearsal 09-28 → 09-30) |
| **Go / no-go** | Alex's written call names whether write scope is live (September plan, week 4) | 10-01 kickoff | — | Wed 09-30 |
| **P4 · Read gaps** | G8 attachments · G9 recurring templates · G10 uncleared · G11 uncategorized activity · G12 paging · G13 CSV | S1 receipt check; the template audit; the `/reconcile` skill after the recs session | 2 | October, after the close |
| **P5 · Structure** | Noctopus decision (§7) · `rippling-mcp` inherits the auth pattern · `MCP_CONSOLIDATION_PLAN.md` row updated · env cleanup | Q4 | 1 + decision | after client #2 |

**What gives if the window is short** (same order as the September plan): P3 commit mode first
(dry-run still ships; Kim posts from the worksheet), then P4, never P1.

## 7. Relation to the 2026-06-15 consolidation direction

That plan kept `qbo-mcp` standalone *because* it was public-bound and could not import Noctopus's
private auth. Internal-only removes that reason, and the CTO principle it cites — one auth
implementation, not five — now points the other way. Two things argue for waiting anyway: the close
runs against this URL for the next three weeks, and P2 copies `aircfo-mcp`'s Google gate wholesale,
which is the exact code a shared module would own. **Recommendation:** standalone through October;
in Q4 decide between (a) `qbo-mcp` as a Noctopus module with its own Railway service and token-key
secret, like the `aircfo-mcp` ruling, or (b) a small internal `mcp-core` (Google gate, OAuth store,
token cipher, write-audit) that `qbo-mcp`, `aircfo-mcp` and `rippling-mcp` import. Whichever lands,
the deployment URL should survive it — grants are keyed by it.

## 8. Reading the production table — done 2026-09-10

Alex ran `railway login`; the service was linked (`railway service qbo-mcp`) and read with the commands
below. Findings are folded into §1 and G1/G2/G15. Two extra facts worth keeping:

- **The connect funnel leaks.** 29 connect-page submissions, 13 connections created. One teammate
  submitted four times and never completed; another ten times for three connections. The Intuit
  consent step or the company picker is losing people — the P2 confirmation page (G5) should also make
  the failure visible.
- **Two connections with heavy traffic and zero tool calls** (569 and 220 requests) are claude.ai
  connectors re-initializing on a timer, not people working. Harmless, but they inflate request counts.

```sh
railway link            # project "QBO MCP Server" · environment production
railway service qbo-mcp
railway logs -n 5000 --json -f 'connection_created OR connect_started OR invalid_grant'   # -n caps at 5000
railway logs -n 5000 --json -f 'mcp_request'
# The remote shell mangles multi-line -e scripts; ship the query as a file instead:
B64=$(base64 < scratch/prod-query.js | tr -d '\n')
railway ssh -- "echo $B64 | base64 -d > /tmp/q.js; node /tmp/q.js"
```

`prod-query.js` opens `/data/qbo-mcp.db` read-only with `/app/node_modules/better-sqlite3` and prints
`connections` (id, realm, email, connected, last token refresh), `oauth_tokens` by kind, live tokens per
connection, and `oauth_clients`. Read `updated_at` as last use: the server refreshes only on demand.

## 9. Out of scope here

The Rippling connector; Sheets identity for teammates (an `aircfo-mcp` concern, v0.1 ruling 12);
the operator surface that is not a terminal (#38); the `.xlsx` read in the Drive connector; any
tool that pays, transfers or voids.
