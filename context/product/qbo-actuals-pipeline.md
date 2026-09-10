# Pulling QuickBooks actuals on a schedule

**Written:** 2026-09-10 · **For:** Johannes, in response to *QBO Owned-Token Pipeline
(Phase 2) — Proposal* (Notion, 2026-08-31) · **State:** proposal, awaiting Johannes's
read; becomes a `decisions.md` entry once agreed

---

# Part 1 — The read, in plain language

## What you got right

Three things in your proposal are correct and not obvious, and they changed what we're
building.

**Intuit's accounting scope is read-and-write, with no read-only option.** You're right,
and you're right about what follows: we already carry write risk on every token we hold,
whether or not we ever write. Most people miss this entirely.

**Your three token-rotation failure modes are all real,** and the third is the sharpest
thing in the document: if Intuit hands back a rotated token and the process dies before
saving it, that token is gone for good and backups don't help, because a backup only ever
holds dead ones. **The existing connector has exactly that hazard today.** You found
independently a class of bug we had only guessed at.

**"A quietly broken schedule is a more likely failure than a hacker."** That's the right
threat model for this system, and it's the kind of judgment that's hard to teach.

You also wrote the argument against your own proposal, and you hedged the write-canary
idea as *needs verifying* rather than promising it. That's how this should be done.

## The one thing that isn't true any more

Your proposal rests on this:

> every monthly refresh needs a live session and a manual re-login

That was real when you wrote it, and it was our bug rather than a property of the
connector. Sessions were being dropped after thirty minutes and answered in a way that
left the client unable to recover, so it *looked* like the login had expired. **It was
fixed and deployed on 2026-09-10.**

What's actually true: tokens persist on their own. Ninety days between the connector and
Claude, a hundred days between the connector and Intuit, and every use pushes both out
again. Nobody should be logging in monthly. You were one of the people hitting that bug
hardest, which is exactly why the proposal reads the way it does.

## Why we're not standing up a second token store

Nearly everything the proposal would build already runs in the QBO connector, and much of
it was hardened this week:

| In the proposal | Already running |
|---|---|
| Encrypted multi-client token store | One row per company, AES-256-GCM, key held apart from the database |
| OAuth exchange and refresh | Built; Google sign-in added 2026-09-10 |
| Race-safe refresh | Concurrent refreshes for one company share a single in-flight call |
| Client connect link | The whole flow, now with a confirmation step naming the company |
| Per-client revoke, plus break-glass | `disconnect_quickbooks`, and an admin revoke tool |
| Audit trail of every pull | One structured line per call, carrying the verified caller |
| Parent-direct decomposition | Shipped in June — it recovers the amounts QuickBooks folds into subtotal rows, after that omission cost about $40k a month |

The reason not to build a second one isn't the duplicated effort. It's that **two services
holding write-capable tokens for the same clients means two token stores, two revocation
paths, and two things to patch** when Intuit changes something. That doubles the custodial
risk in order to solve a scheduling problem — and custody is the part you rightly call
existential.

## What you found that we genuinely don't have

**Nothing in our stack runs unattended.** The connector is request-driven: something has to
ask it. Your monthly-refresh-without-a-human need is real and unmet, and it's the part
worth building.

## The shape we're proposing

**One custodian, two ways in.**

The connector keeps every Intuit credential — that's its job and it's now built for it. It
grows a second door for automations: a token-authenticated read-only API that returns the
same shaped reports its Claude tools return.

**You build the pipeline as your own service.** You own the schedule, the landing-grid
write, the model logic, the alerting. You call the connector for data and never hold an
Intuit token. Your existing dashboard code transfers almost entirely — minus the OAuth,
the refresh and the rotation handling, which is the part that was going to be dangerous.

This also removes the client-switching problem for you completely. A service token
addresses a company by its realm id, so switching clients is a parameter, not a
reconnection.

## Four things from your proposal we're adopting

Credited, and going into the connector rather than a new service:

1. **Harden the crash window on refresh**, so a rotated token is durable before it's used.
2. **A keep-alive touch**, so a client nobody closed this quarter doesn't silently die at
   Intuit's hundred-day mark.
3. **Alerts on failed refresh and stale connections.** We have the logs and no alarm.
4. **Write down that "one process refreshes" is an assumption**, not a guarantee — it holds
   only because we run a single instance.

## One warning

Revocation is easier to get wrong than it looks. We shipped a bug on 2026-09-10 where the
wrong token got revoked and killed a live connection seconds after creating it, because the
library silently ignores a mis-named parameter. If you build any revoke path, that
parameter deserves a test of its own.

---

# Part 2 — Spec

Two pieces. The first is on the connector and is small; the second is yours.

## Piece 1 — a service door on the connector

**Authentication.** A single long random bearer in `SERVICE_TOKEN`, compared in constant
time, with `SERVICE_PRINCIPAL_ID` (e.g. `svc:actuals-pipeline`) written to every log line.
The pattern already exists in `aircfo-mcp` (`src/auth/caller.ts`); copy it rather than
inventing one. The token lives only in Railway's variables — never in a repo, never on a
laptop.

**Endpoints.** All `GET`, all read-only, all under `/api/`.

| Endpoint | Returns |
|---|---|
| `/api/connections` | Every company the connector holds: realm id, company name, whether it needs re-authorization, when it last refreshed. Never tokens |
| `/api/reports/:report` | One report for one company |

`:report` is an allowlist — `profit-and-loss`, `balance-sheet`, `trial-balance`,
`general-ledger` to start. Query parameters are the same names the Claude tools already
take, so there is one vocabulary to learn: `realm`, `start_date`, `end_date`,
`accounting_method`, `summarize_column_by`, `format`, `max_rows`.

```
GET /api/reports/profit-and-loss
      ?realm=793988035
      &start_date=2026-08-01
      &end_date=2026-08-31
      &accounting_method=Accrual
      &summarize_column_by=Month
Authorization: Bearer <SERVICE_TOKEN>
```

**Response shape** is exactly what the Claude tools return:

```json
{ "columns": ["group", "Aug 2026"],
  "rows":    [["Income", "41000 Accounting Services", "352109.00"]],
  "totals":  [["Income", "Total Income", "521873.00"]] }
```

`totals` is the part to read carefully: it carries subtotals **and** any amount booked
directly to a parent account, which exists nowhere else in the response. Summing `rows`
alone silently loses money. This is the decomposition you described building — it is
already here, and it is why the shape has three arrays instead of two.

**Errors that matter to a pipeline**, so it can act rather than retry blindly:

| Status | Meaning | What the pipeline should do |
|---|---|---|
| `404` | No connection for that realm | Ask the AM to run the connect link |
| `409` | Connection needs re-authorization | Same, and stop retrying |
| `502` | Intuit failed or timed out | Retry later; the connector already retried twice |

**Hard limits.** Read-only forever: no write endpoint is ever added to this door, whatever
the connector's Claude tools grow later. Every call logs principal, realm and report.

**Also on the connector**, from the list above: the refresh crash window, a keep-alive
touch, and alerting on stale connections.

**Size:** about one working session.

## Piece 2 — the pipeline

Yours, as its own service.

**What it does monthly:** read its own map of client → realm → destination grid, call the
connector for each client's reports, write the values into the landing grid, and alert on
anything that failed.

**What it never does:** hold an Intuit token, run an OAuth flow, refresh anything, or
revoke anything. Those stay with the connector. That deletes the most dangerous third of
your original design and all of the rotation-race handling.

**Where the client map lives:** with the pipeline. The connector knows realms and company
names; it knows nothing about which grid a client's numbers belong in, and shouldn't.

**Onboarding a client is unchanged from your proposal** and already exists: the AM sends
the connect link, the client approves at Intuit, the credentials land in the connector's
encrypted store, and nothing passes through anyone's laptop. **Every client still needs
that one human authorization** — no service token can reach a company nobody consented to.

## Working in this repo

Short version, since you'll be pushing here.

- **Node 22** (`mise x node@22 -- pnpm …`); the default Node on a Mac is too new for one of
  the native dependencies.
- `pnpm typecheck && pnpm test` before you push. CI runs both on every pull request.
- Branch, conventional commit (`feat:`, `fix:`, `docs:`), pull request into `main`, CI
  green, then merge.
- **Merging to `main` deploys to production.** There is no staging environment; the Railway
  sandbox was retired. Local development runs against an Intuit *sandbox* company.
- TypeScript strict, no `any`. Comments explain *why*, not what.
- Tests live in a `__tests__/` folder beside the code they cover.

`context/decisions.md` is worth reading before you start — it is why things are the way they
are, including two entries from 2026-09-10 that came out of exactly the risks you named.
