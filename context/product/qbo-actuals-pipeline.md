# Scheduled QuickBooks pulls

**Written:** 2026-09-10 · **State:** proposal, for review; becomes a `decisions.md`
entry once agreed · **Context:** prompted by Johannes's *QBO Owned-Token Pipeline
(Phase 2)* write-up, Notion, 2026-08-31

## What the QBO server is

airCFO runs a small server that sits between us and QuickBooks. A client's QuickBooks
company gets connected to it once, through Intuit's approval screen — we do that ourselves,
because airCFO holds accountant access to our clients' books. From then on the server holds
that connection and can read those books on our behalf.

It already does the parts that are tedious and easy to get dangerously wrong: it stores
each client's credentials encrypted, renews them before they expire, and can cut a client
off on demand. That work is done and running in production.

## The three things we need it to do before we put the team on it

**1. Answer questions through Claude.** Someone opens a Claude session, points it at a
client, and asks — pull the P&L, show me what we spent on software, drill into that
balance. **This works today.** It is how the close work runs.

**2. Pull reports on a schedule.** Every month, fetch the same reports for the same
clients and land the numbers where the model expects them, with nobody in the loop.
**This does not exist.** The server only answers when something asks it, and today the
only thing that asks is a person in a Claude session. There is no scheduler and no way to
say "pull August for these twelve clients at 6am on the fourth." **This is the gap the
rest of this document proposes closing.**

**3. Let one person move quickly between clients.** A connection binds to one QuickBooks
company, chosen at Intuit's approval screen. That binding is what keeps clients isolated —
a session cannot reach a company that was never connected — and it is also what makes
moving between clients slow, because today you disconnect and reconnect.

**This is half solved.** In Claude Code it already works: each client has its own folder,
each folder declares its own connection, and all of them stay authorized at once, so
switching clients is switching directories. On claude.ai and in Cowork it does not work
yet, because claude.ai will not accept the same server twice under two names. Two
approaches are being evaluated and are written up in
[`multi-client-access.md`](multi-client-access.md).

## The proposed shape

The hardest and riskiest half of a scheduled-pull system — storing client credentials,
renewing them before they expire, handling two jobs trying to renew at once, and cutting a
client off — **already exists in the server.** It should not be built a second time.

There is a reason beyond the effort saved. Intuit does not
offer a read-only connection: the same credential that reads a client's books can also
change them. Two separate places holding credentials like that means two places to
protect, two ways to be breached, and two things to fix when Intuit changes something. One
place is meaningfully safer than two.

So the shape is:

- **The server** keeps every client credential, and grows one small addition: a private
  door that a scheduled job can knock on to ask for a report, without being a person in a
  Claude session.
- **The pipeline** is a separate service. It knows the schedule, which clients to pull,
  and where the numbers go. It asks the server for the reports and never touches a
  credential.

That makes the pipeline a schedule, a transform and a write, rather than a second
platform. It also sidesteps the third problem above: a scheduled job names a client by its
realm id — QuickBooks' own id for a company — so it never has to switch anything.

Three smaller improvements to the server go in at the same time: making credential renewal
safe against a crash mid-renewal, keeping a connection alive when nobody has pulled a
client's books for a quarter, and alerting when a renewal fails.

---

# Spec

Two pieces. The first is on the server and is small; the second is yours.

## Piece 1 — a private door on the server

**Who may knock.** A single long random password, held in the server's hosting
configuration and nowhere else — not in a repository, not on anyone's laptop. Requests
carry it in an `Authorization` header. Every request is logged with which job called and
which client it touched.

**Endpoints.** All read-only.

| Endpoint | Returns |
|---|---|
| `GET /api/connections` | Every client the server holds a connection for: realm id, company name, whether the connection needs reconnecting, when it last renewed. Never credentials |
| `GET /api/reports/:report` | One report for one client |

`:report` is a fixed list — `profit-and-loss`, `balance-sheet`, `trial-balance`,
`general-ledger` to start. The query parameters are the same ones the Claude tools already
use, so there is one vocabulary rather than two: `realm`, `start_date`, `end_date`,
`accounting_method`, `summarize_column_by`, `format`, `max_rows`.

```
GET /api/reports/profit-and-loss
      ?realm=793988035
      &start_date=2026-08-01
      &end_date=2026-08-31
      &accounting_method=Accrual
      &summarize_column_by=Month
Authorization: Bearer <the password>
```

**What comes back.**

```json
{ "columns": ["group", "Aug 2026"],
  "rows":    [["Income", "41000 Accounting Services", "352109.00"]],
  "totals":  [["Income", "Total Income", "521873.00"]] }
```

**Read `totals` carefully — this one matters for correctness.** QuickBooks sometimes books
an amount directly against a parent account rather than any of its children. That amount
appears **only** in the parent's subtotal, and the subtotals live in `totals`. If a
pipeline sums `rows` alone it will silently report less money than the client actually
earned or spent, and the numbers will look plausible. This is why the response has three
arrays instead of two.

**Errors worth handling**, so the pipeline can act rather than retry blindly:

| Status | Meaning | What the pipeline should do |
|---|---|---|
| `404` | That company has never been connected | Someone on the team connects it once, then re-run |
| `409` | The connection expired or was revoked | Same — reconnect once, and stop retrying meanwhile |
| `502` | QuickBooks failed or was too slow | Retry later; the server already retried twice |

**One hard rule.** This door is read-only permanently. No endpoint that changes a client's
books is ever added to it, whatever the server's Claude tools grow later.

**State: built and deployed, 2026-09-11.** Both endpoints exist behind the service
token. The auth layer is specified in full in [`service-auth.md`](service-auth.md).
What remains before a scheduled pull can work is not code: **each client company
needs a connection**, and most currently have none.

## Piece 2 — the pipeline

A separate service, running on its own schedule.

**Each month it** reads its own list of which client maps to which realm id and which
destination grid, asks the server for that client's reports, writes the values into the
landing grid, and raises an alert on anything that failed.

**It never** holds a QuickBooks credential, runs an approval flow, renews anything, or
disconnects anything. All of that stays with the server, which keeps the most dangerous
third of the problem — and all the renewal-race handling — out of the pipeline entirely.

**The client list lives with the pipeline.** The server knows realm ids and company names.
It knows nothing about which grid a client's numbers belong in, and it shouldn't.

**Connecting a company is a one-time step, and we do it ourselves.** Because airCFO holds
accountant access to our clients' books, someone on the team signs in and approves the
connection for that company — the client isn't involved. **Every company still needs that
one connection before a scheduled job can read it**, which is what the 404 above means.

## Before you start

Setup, the working loop and the repo's conventions are in
[`ONBOARDING.md`](../../ONBOARDING.md) at the root of this repository. Read that first;
it is written for exactly this situation.
