# Fixes needed for the Cowork beta setup flow

Date: 2026-06-26
Source: a teammate ran the **Claude for Startup Finance** plugin's `finance-context-builder`
setup end-to-end in Claude Cowork (the plugin bundles this server as its QuickBooks connector).
Several failures trace back to this server. Each item below was checked against the source on
2026-06-25/26; confidence is flagged per item.

The client side (the context-builder skill) has already been hardened against these (pages the
account list, prefers the airCFO connector, degrades gracefully on partial access). The fixes
below address the **root cause** on the server so the experience is seamless regardless of client.

---

## 1. `search_accounts` returns the entire chart of accounts and blows the output limit — HIGH, confirmed

**Symptom.** A 257-account chart returned ~132K characters and the `search_accounts` call errored
out mid-setup. A 250-account chart is normal for a Series A startup, so most beta users will hit this.

**Root cause (confirmed in code).**
- `src/tools/_search.ts` → `buildCriteria()` only appends a `limit` criterion **when the caller
  passes one** (`if (typeof args.limit === "number")`, line ~81). The Zod `limit` field says
  *"default 100"* in its `.describe()` (line ~38) but **that default is never applied** — it's
  documentation only. When the model omits `limit` (as it does when it just wants "the whole COA"),
  `buildCriteria` returns `{}`, and `node-quickbooks` treats `{}` as *"no filter — return all"*
  (its own comment, line ~85). So the call returns every account.
- `src/tools/ledger.ts` → `registerEntity()` search handler returns `{ count, results }` where each
  row is `slimEntity(account)` — and `slimEntity` (`_search.ts`) only strips `domain` and `sparse`.
  A full QBO `Account` object still carries `MetaData`, `CurrencyRef`, `AccountSubType`,
  `Classification`, `FullyQualifiedName`, etc. — roughly 500 chars/account. 257 × ~500 ≈ 132K.

**Fix (combination — each helps independently):**
1. **Enforce the default limit server-side.** In `buildCriteria` (or the `registerEntity` handler),
   apply `const limit = args.limit ?? DEFAULT_LIMIT` (e.g. 100) so a call is *never* unbounded.
   Right now the only thing standing between a caller and the full table is the model remembering
   to pass `limit` — make it a server guarantee.
2. **Add a compact projection for accounts (biggest win).** The reports path already has this idea
   (`_format.ts` → `shapeReport` flattens to compact columns/rows with a `maxRows` envelope). Do the
   equivalent for `search_accounts`: return only the fields a caller needs — `Id`, `Name`, `AcctNum`,
   `AccountType`, `AccountSubType`, `Classification`, `Active`, `CurrentBalance`, `ParentRef` — instead
   of the whole object. At ~100 chars/row the full 257-account chart fits comfortably in one response,
   which is exactly what the context-builder wants (it needs *all* accounts to draft the map).
3. **Return a truncation/paging envelope** like `shapeReport` does: `{ results, count, returned,
   truncated, next_offset, hint }`, so when a cap is hit the caller knows to page via the existing
   `offset` input rather than getting an error.

**Why all three:** (1) stops the hard error, (2) makes the common "give me the whole COA" case work
in one call (fewer paging round-trips, less rate-limit pressure), (3) makes paging discoverable when
a chart really is huge.

**Verify.** Call `search_accounts` with no arguments against a 250+ account company; assert the
response is bounded, the projection is compact, and a paging hint is present when truncated.
Consider applying the same projection treatment to the other verbose `search_*` entities
(invoices/bills/journal entries) since they have the same unbounded shape.

---

## 2. MCP OAuth completion dead-ends on the loopback redirect (`localhost:3118` "can't connect") — HIGH, mechanism confirmed

**Symptom.** After granting Intuit consent, Safari showed *"Safari Can't Connect to the Server —
localhost:3118/callback?code=…&state=…"*. The connection appears to fail.

**Root cause (confirmed in code).** `src/auth/intuit-callback.ts` (lines ~76–79) finishes the flow
with a blind `res.redirect(redirect.toString())` to the MCP client's **registered loopback
`redirect_uri`** (`http://localhost:3118/callback`). That loopback is the Claude desktop app's local
listener. If it isn't reachable at the instant of redirect — a stale/rotated port, the app restarted
during the flow, the listener timed out, or the user is in a context with no local listener — the
browser dead-ends on a raw connection error.

Important nuance: the **QuickBooks connection is already created server-side** (lines ~56–63) *before*
the redirect. What fails is only delivery of the MCP authorization code back to the client, so Claude
never completes its token exchange and shows the connector as not-connected even though the upstream
connection exists.

**Fix.**
1. **Replace the blind 302 with an interstitial success page.** Instead of immediately redirecting,
   render a small page: *"✅ QuickBooks connected. Returning you to Claude…"* that (a) attempts the
   redirect to the loopback via JS / `<meta http-equiv="refresh">`, and (b) shows a visible,
   user-clickable "Return to Claude" link plus a line: *"If this page shows an error, your connection
   still succeeded — go back to Claude and try your request again."* Safari handles a user-initiated
   localhost navigation more reliably than an auto-302, and the user never lands on a dead error page.
2. **Keep the flow fast** so the client's loopback listener is less likely to have timed out by the
   time the callback fires.

**Honest caveat.** The redirect *destination* is dictated by the MCP client (Claude registers the
loopback URI); the server cannot change where the code is delivered. The interstitial is a real UX
mitigation and removes the dead-end, but fully reliable loopback delivery is ultimately a
client/transport concern. If Claude/Cowork exposes a hosted (non-loopback) redirect for remote MCP
servers, that path is inherently more robust than a desktop loopback — worth raising with Anthropic,
but not something this server controls.

**Verify.** Complete a connect with the desktop loopback intentionally unavailable; confirm the
interstitial renders, states the connection succeeded, and offers a working recovery path.

---

## 3. "Unavailable scope was requested" on connect — MEDIUM, real inconsistency found; reproduce to confirm trigger

**Symptom.** Image from the test: *"Error — Unavailable scope was requested. Entity: airCFO."* during
a connect attempt.

**What I found.** There is a genuine scope inconsistency in this server:
- `src/index.ts` mounts `mcpAuthRouter({...})` **without** a `scopesSupported` option (lines ~89–96),
  so the published OAuth metadata advertises **no `scopes_supported`**.
- `src/auth/provider.ts` nonetheless hard-codes the **Intuit** scope string
  `com.intuit.quickbooks.accounting` as the MCP token scope — returned from `exchangeAuthorizationCode`
  / `exchangeRefreshToken` and `verifyAccessToken` (lines ~20, ~81, ~98, ~109).

So the server grants/echoes a scope it never advertises as supported. The SDK's `/authorize` handler
(`@modelcontextprotocol/sdk/.../handlers/authorize.js`) does **not** reject scopes — it just forwards
the requested scopes to `provider.authorize`, which ignores them — so the rejection is not there. That
leaves the registration/token layer or the client reacting to the missing/mismatched `scopes_supported`
as the likely source. I could not pin the exact rejection point by static reading alone, and the
"Entity" wording in the screenshot also resembles other connectors (e.g. Ramp), so I can't be 100%
certain this screen is *this* server vs. another connector the tester was also connecting in that run.

**Fix direction (safe regardless of the exact trigger).**
- Make the scope story coherent. Either:
  - **(a) Advertise it:** pass `scopesSupported: ["com.intuit.quickbooks.accounting"]` to
    `mcpAuthRouter` so the metadata lists exactly what the provider grants; **or**
  - **(b) Better — stop leaking Intuit's scope into the MCP layer.** The MCP grant here is a single,
    all-or-nothing, read-only connection. Don't surface Intuit's internal scope string as the MCP OAuth
    scope at all — advertise no scope (or a simple server-level `qbo.read`) and grant it unconditionally.
    This removes the dependency on a client requesting one exact magic string and makes the flow tolerant
    of whatever Claude sends.
- **Before committing,** reproduce with the MCP Inspector or a fresh Claude connect and capture the
  exact OAuth error (which endpoint returned `invalid_scope`, and what `scope` the client requested).
  That confirms whether this screen is this server and which fix lands it.

---

## 4. Connector is generically named and gets confused with Intuit's official QuickBooks connector — LOW/MEDIUM

**Symptom.** On the tester's first run, Claude used *Intuit's own* QuickBooks MCP connector (the
generic default) instead of this airCFO connector, and the output was poor.

**Root cause.** Not a bug, but an identity collision: `resourceName: "QuickBooks Online MCP"`
(`src/index.ts`, line ~94) and server name `qbo-mcp` (`src/server.ts`) are generic. In a Cowork
environment that may also have Intuit's official QuickBooks connector installed, neither the user nor
Claude can easily tell them apart, and the wrong one gets used.

**Fix.** Brand this connector distinctively — e.g. `resourceName: "airCFO QuickBooks (Startup
Finance)"` — so it is unmistakable in Claude's connector list and on the consent screen. The
plugin-side half is already done: the `.mcp.json` server key was renamed `quickbooks` →
`aircfo-quickbooks` in the `claude-startup-finance` repo on 2026-06-26. This server's `resourceName`
should be updated to match so the two line up.

---

## Out of scope for this repo (noted so they aren't chased here)

These came up in the same test but are **not** this server's responsibility:
- **Ramp** returned *"You do not have permission to view checking accounts"* — a Ramp OAuth
  scope/role limitation on the vendor connector.
- **Mercury** was untested (no credentials available).

Both are handled on the plugin/docs side (the skill now degrades gracefully and the first-session
guide documents partial-access behavior).

---

## Suggested order

1. **#1 (account-list paging/projection)** — highest blast radius; every user with a real COA hits it.
2. **#2 (OAuth interstitial)** — removes the scariest dead-end during connect.
3. **#3 (scope coherence)** — reproduce first, then land (a) or (b).
4. **#4 (connector branding)** — cheap, prevents the wrong-connector first run.
