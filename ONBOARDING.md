# Onboarding

For anyone joining this repo, whether or not you write code for a living. Most of the
people working here build with Claude rather than by hand, and this is written for that.

**A good first prompt in a fresh Claude Code session:**

> Read `README.md`, `CLAUDE.md` and `ONBOARDING.md`, then tell me what this server does
> and what state it is in.

Claude picks up `CLAUDE.md` automatically in every session here, so the house rules are
already loaded before you ask for anything.

## What this repo is

A server that sits between airCFO and QuickBooks Online. A client's QuickBooks company is
connected to it once — we do that ourselves, since airCFO holds accountant access to our
clients' books — and from then on the server can read those books on our behalf.

It exists because the off-the-shelf options didn't fit: Intuit's own connector returns
canned report widgets and can't reach the general ledger, and the open-source one is
built for one person on one laptop with one company. This one is multi-company, hosted,
and gated to airCFO staff.

**Everything it exposes today is read-only.** It can look at a client's books and change
nothing.

## Setting up, once

You need [mise](https://mise.jdx.dev) for Node and [pnpm](https://pnpm.io). Then:

```sh
git clone https://github.com/aircfo/qbo-mcp.git
cd qbo-mcp
mise x node@22 -- pnpm install
mise x node@22 -- pnpm test        # should be all green before you change anything
```

**Always run commands through `mise x node@22`.** The default Node on a Mac is newer than
one of the dependencies supports, and the error it produces is confusing rather than
clear. If you see a complaint about `NODE_MODULE_VERSION`, run
`mise x node@22 -- pnpm rebuild better-sqlite3` once and carry on.

To run the server locally you need a `.env` — ask Alex for the values. Local development
points at an **Intuit sandbox company**: a free fake company Intuit provides so you can
develop against real API behaviour without touching a real client's books. Never point
local development at production credentials.

```sh
mise x node@22 -- pnpm dev
```

## The loop

1. **Branch.** `git checkout -b feat/short-description` — `feat/`, `fix/` or `docs/`.
2. **Make the change**, with Claude or by hand.
3. **Check it.** `mise x node@22 -- pnpm typecheck && mise x node@22 -- pnpm test`.
   Both have to pass. If you changed behaviour, there should be a test that would have
   failed before your change.
4. **Commit** with a `feat:` / `fix:` / `docs:` prefix and a message that explains *why*,
   not what the diff already shows.
5. **Open a pull request** into `main`. The checks run automatically.
6. **Merge when they're green** — and then watch the deploy, because of the next section.

## The one thing to internalise

**Merging to `main` deploys to production within a few minutes.** There is no staging
environment. Real client connections and real books are on the other side of that merge.

So: a pull request is the last cheap moment. Use it. After merging, watch the deploy
finish and check the logs before you walk away.

If something goes wrong, the fastest fixes in order are usually: change an environment
variable in Railway (no deploy needed), revert the merge commit and let it redeploy, or
roll back to the previous deployment in the Railway dashboard.

## Rules that matter more than style

1. **Never print, log, or save a token.** Not in a log line, not in an error message, not
   in a test fixture, not pasted into a document or a chat. If you need to prove a
   credential works, print the status code, never the credential.
2. **Nothing writes to a client's books** without an explicit dry run, a human approving
   that exact batch, and a record of who approved it. Don't add a write path "just to
   test".
3. **Nothing ever touches money movement.** No wires, transfers or bill payments, whatever
   the API allows and whoever asks.
4. **Don't change the deployment URL**, and don't change `TOKEN_ENCRYPTION_KEY`. Either
   one forces every teammate and every client company to be reconnected by hand.
5. **Don't commit secrets.** `.env` is ignored by git; keep it that way.

## The words we use

| Term | Means |
|---|---|
| **Realm id** | QuickBooks' own id for a company. The reliable way to say which client's books you mean; company names are editable and sometimes wrong |
| **Connection** | One stored link between this server and one QuickBooks company: the credentials, who authorized it, when it last renewed |
| **Grant** | The authorization a Claude client holds to talk to this server. A person can hold several, one per client folder |
| **MCP** | The protocol Claude uses to call tools. This server speaks it over HTTP |
| **Tool** | One thing Claude can call — `get_profit_and_loss`, `search_vendors`. Roughly 42 of them, all read-only |
| **`rows` and `totals`** | Every report comes back as both. `totals` holds subtotals **and** amounts booked directly to a parent account, which appear nowhere else. Summing `rows` alone under-reports |
| **Session** | A live conversation between one Claude client and this server. Cheap, disposable, re-established automatically |
| **Sandbox** | A free fake QuickBooks company from Intuit, for local development |

## Where to read next

| File | What it gives you |
|---|---|
| `README.md` | What the server does and the full tool list |
| `CLAUDE.md` | The house rules, loaded automatically by every Claude session here |
| `context/decisions.md` | Why things are built the way they are. Append-only; read it before proposing a change to something that looks odd, because it is usually odd on purpose |
| `context/product/` | Design options that haven't been decided yet |
| `DEPLOY.md` | Hosting, environment variables, local sandbox setup |
| `SECURITY.md` | What we hold, how it's protected, and what we've accepted as risk |

## When you make a call of your own

Add an entry to `context/decisions.md`: the date, what you decided, and — most
importantly — *why*, including what you rejected. That file is the reason someone six
months from now doesn't undo your work by accident, and it is the single highest-value
thing you can leave behind.

## Who to ask

Alex owns this repo. If something in here is wrong or out of date, fixing it is a welcome
first pull request.
