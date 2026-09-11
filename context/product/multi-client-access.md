# Working across several clients' books from one connector

**Written:** 2026-09-10 · **State:** options recorded, nothing decided ·
**Decide when:** the team's operator surface is settled (bookkeeping-automation key
question #38, and the open question on the 2026-09-08 vision page)

## The problem

A grant to this server binds to exactly one QuickBooks company. That binding is made
at Intuit's consent screen and frozen into the connection, which is what makes
cross-client isolation airtight: a token cannot reach a company its holder never
consented to.

The cost of that design lands on anyone who works across several clients in a single
surface. To move from airCFO's books to another client's, they must disconnect the
connector and reconnect it, re-running Google sign-in and Intuit consent. For a
bookkeeper closing five clients in a week, that is five setup rituals per pass.

**The constraint that forces the question, confirmed 2026-09-10:** claude.ai will not
accept the same URL as two connectors under different names. So the obvious answer —
one connector per client, all pointing at this deployment — is unavailable.

## What is already solved, and where

**Claude Code is not affected.** Grants there are keyed by `(server name, URL)`, proved
by experiment in `bookkeeping-automation/firm/history/test-2026-08-28-credential-key.md`.
Each client folder declares `qbo-<slug>` at the same URL, each gets its own grant, and
all of them stay authorized at once. Switching clients is switching directories.

**So this is a claude.ai and Cowork problem specifically**, which is why the
recommendation below is to decide it after the operator surface, not before.

## Option 1 — path-scoped URLs, one per client

`https://<host>/c/aircfo/mcp`, `https://<host>/c/<slug>/mcp`. Distinct URLs, so
claude.ai treats them as distinct connectors, and each carries its own grant.

**What changes**

- The MCP routes mount under an optional client slug alongside the bare `/mcp`.
- A slug-to-realm registry — a small table, administered by the existing admin tools —
  so a slug means one company and not merely a label someone typed.
- The connect flow carries the slug from Google through Intuit to the confirmation
  step, which then **refuses a company that is not the one the slug names**.
- Request handling rejects a token whose connection realm does not match the slug in
  the path it arrived on.

**What it buys.** The wrong company stops being a mistake anyone can make and becomes
unreachable. A grant issued for `/c/clientb/mcp` cannot answer about airCFO, whatever
the caller or the model intends. That is a stronger guarantee than the connector naming
convention gives us today, where the only thing separating two clients is a string a
person chose.

**The risk, and it is specific and documented.** Claude Code checks RFC 9728 protected-
resource metadata and requires the `resource` field to equal the exact URL it is
connecting to. **Ramp's business-alias URLs failed precisely this check and were
reverted** (`bookkeeping-automation/firm/decisions.md`, 2026-08-28; the connector
registry still carries the warning). Our OAuth router serves one protected-resource
document at the root today; per-path resources need that metadata served per path, and
the `WWW-Authenticate` challenge on each path must point at its own document.

**Therefore the first step is not to build it.** Stand up one path-scoped route with its
metadata, and confirm both Claude Code and claude.ai can authorize against it. If that
check fails the option is dead, exactly as it was for Ramp, and the day spent proving it
is the cheapest part of the exercise.

**Effort.** Roughly a session to prove the discovery works, one to two more to build the
registry, the slug-aware connect flow and the realm check.

## Option 2 — bind the token to a person, and select the company per call

Today a downstream token resolves to one connection. It could instead resolve to a
verified identity, with that person's companies available underneath it: a
`list_companies` tool, and either a `company` argument on the data tools or a
session-level selection.

**Why it is tempting.** The data already has this shape. Connections are keyed by
`(realm, verified email)`, so one person holding several companies is a natural row set,
not a schema change. Switching clients would become a sentence in the conversation, with
no reconnection at all — the most seamless answer available.

**Why it is not recommended.** It creates a failure this server currently cannot have:
a call that names the wrong company returns a **plausible, correct-looking report about
the wrong client's books**. Every other failure mode here is loud — a refused token, a
404, a fault from Intuit. This one is silent, and it lands in a deliverable. The whole
client-folder architecture in the bookkeeping repo exists to make that outcome
structurally impossible, and this option would reintroduce it at the connector layer
after the folder layer worked to remove it.

It also widens the blast radius of a single leaked token from one company to every
company that person has connected.

**If it were chosen anyway,** the mitigations would be: make the company argument
required with no default, so an omission fails instead of guessing; echo the company
name and realm in every response, so a wrong one is visible in the transcript; record
the realm on every audit line; and have the close skills assert the expected realm
before acting. Those reduce the risk. They do not remove it, because a model supplying a
wrong-but-valid argument is not an error condition.

**Effort.** Larger than Option 1 and spread wider: the provider, the transport, the
rate limiter, the disconnect semantics, and the input schema of all 42 tools.

## Option 3 — one deployment per client

A separate Railway service per client, each with its own URL and its own single company.
No code changes at all.

**Rejected.** It multiplies the operational surface by the client count: a service, a
volume, an encryption key and a set of Intuit credentials each, all to be kept patched
together. It is defensible for two or three clients and untenable at twenty, and the
firm's plan is twenty.

## Recommendation

**Do not build either yet.** The choice is downstream of a decision that has not been
made: what surface the team actually works in.

- If the answer is **Cowork or claude.ai**, Option 1 is the design, and its RFC 9728
  proof is the first task.
- If the answer is **Claude Code with a skin over it**, there is nothing to build. Per-folder
  grants already solve this, and the effort belongs elsewhere.

That decision is bookkeeping-automation's key question #38, and the vision page lists the
team's working surface as openly unresolved. Building connector infrastructure for a
surface nobody has committed to is how you end up maintaining both.

**If a decision is forced before then,** take Option 1. It costs more setup than Option 2
and buys an invariant that a model cannot violate, which is the right trade for a tool
whose output becomes financial statements.

## Also worth knowing

**The account-scoped connector is not covered by any of this.** "airCFO's Custom QBO MCP"
appears in every conversation and every folder, whatever else is configured, and it points
at airCFO's own books. Under Options 1 and 3 it remains the one connector that ignores the
boundary. Renaming it to say plainly whose books it holds is worth doing regardless of
which option wins.

**What would change the recommendation:** claude.ai gaining per-connector naming for a
shared URL (this whole document becomes unnecessary); a decision to run the team on Claude
Code (same); or the RFC 9728 proof failing (Option 1 dies, and the question becomes whether
Option 2's mitigations are enough — I would argue they are not, and that the answer is then
Claude Code).
