# Service-principal access — step 1 of the scheduled-pull work

**Written:** 2026-09-10 · **State:** spec, ready to build · **Parent:**
[`qbo-actuals-pipeline.md`](qbo-actuals-pipeline.md)

Today the server can only be reached by a person in a Claude session: every request to
`/mcp` carries a bearer that was minted after a Google sign-in and is bound to one
connection. A scheduled job is not a person and cannot sign in, so before anything can be
pulled on a schedule the server needs a second way in — a non-interactive caller that
proves itself with a shared secret.

This spec covers that door and the one endpoint that makes it useful and testable. The
report endpoints are step 2 and are deliberately not here; auth is worth landing and
reviewing on its own.

## In scope

- Configuration for a single service principal.
- Middleware that authenticates it in constant time.
- `GET /api/connections` — which companies the server can currently pull, and nothing else.
- Rate limiting, logging, and tests for all of the above.

## Not in scope

- `GET /api/reports/:report` (step 2).
- More than one principal. The shape below leaves room; v1 has exactly one.
- Anything that writes. See the hard rule at the end.

## Mental model

The server ends up with two front doors that share no code path:

| Door | Who comes through | Proves identity by | Reaches |
|---|---|---|---|
| `/mcp` | A person in a Claude session | Google sign-in, then an MCP bearer bound to one connection | The one company that connection holds |
| `/api` | A scheduled job | A single long shared secret | Any connected company, read-only |

The second door reaches more than the first. That is the point, and also the risk. It is
bounded three ways: it is read-only permanently, it does not exist unless a secret is
configured, and every call is logged with the principal and the company it touched.

## Configuration

Two variables in `src/config/env.ts`, following the patterns already there.

```ts
// A scheduled job authenticates with this instead of signing in. Optional: when
// it is unset the /api surface is not mounted at all, so the door does not
// exist until someone deliberately opens it.
SERVICE_TOKEN: z
  .string()
  .min(32, "SERVICE_TOKEN must be at least 32 characters")
  .optional(),

// Identifies the caller in logs. One principal today; a token-to-principal map
// is the extension point if that ever changes.
SERVICE_PRINCIPAL_ID: z.string().min(1).default("svc:actuals-pipeline"),
```

`optional()` rather than a default, so that the absence of a value is representable.
Everything else in this file is required or defaulted, and an invalid environment still
exits at boot — that behaviour is unchanged.

**Generating the secret:** `openssl rand -base64 48`. It lives in Railway's variables for
the "QBO MCP Server" project and nowhere else — not in the repository, not in a `.env`
that gets shared, not pasted into a chat or a ticket. The pipeline reads it from its own
hosting configuration.

**Unset means absent, not refusing.** With no value the `/api` routes are never
registered, so those paths 404 like any other unknown URL. A surface that exists and
rejects everything advertises that it exists; one that was never mounted does not.

## The middleware

`src/api/auth.ts`, exporting `requireServicePrincipal`.

**Comparison must be constant-time and must not leak length.** `timingSafeEqual` throws
when its two buffers differ in length, so the obvious workaround compares lengths first
and returns early — which leaks the secret's length through timing. Hashing both sides to
a fixed 32 bytes first removes both problems at once:

```ts
function secretMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
```

**Behaviour, exhaustively:**

| Condition | Status | Body | Log |
|---|---|---|---|
| `SERVICE_TOKEN` unset | 404 | Express default | — (routes not mounted) |
| No `Authorization` header | 401 | `{"error":"unauthorized"}` | `service_auth_rejected`, `reason: "missing"` |
| Header is not `Bearer <token>` | 401 | same | `service_auth_rejected`, `reason: "malformed"` |
| Token does not match | 401 | same | `service_auth_rejected`, `reason: "mismatch"` |
| Over the rate limit | 429 | `{"error":"rate_limited"}` | `service_rate_limited` |
| Match | passes through | | `api_request` on finish |

Every 401 carries `WWW-Authenticate: Bearer`. Every 429 carries `Retry-After` in whole
seconds, exactly as the per-IP limiter in `src/index.ts` already does.

**The principal reaches the handler** through declaration merging, the same mechanism the
MCP bearer uses for `req.auth`:

```ts
declare global {
  namespace Express {
    interface Request {
      principal?: { id: string };
    }
  }
}
```

**Rate limiting.** A dedicated `RateLimiter(300, 60_000)` keyed by principal id, swept on
its own five-minute interval — `new RateLimiter(max, windowMs)`, `check(key)`, `sweep()`,
the same three-method surface `ipLimiter` uses. A monthly pull of twelve clients across
four reports is roughly fifty calls, so three hundred a minute leaves room for a backfill
while still bounding a runaway loop. The per-IP limiter runs first and independently, at
600 a minute for the pipeline's whole host; the principal limit is the tighter of the two
and is the one that will actually bite.

## The endpoint

`GET /api/connections` — which companies the server can pull today. It reads only our own
database and makes no call to QuickBooks, so it still answers when Intuit is down.

```json
{
  "connections": [
    {
      "realmId": "793988035",
      "companyName": "airCFO",
      "connectionId": "6154d962-13c8-4720-9826-8bc896ab1bba",
      "status": "ok",
      "connectedAt": "2026-09-04T18:22:45.000Z",
      "lastRefreshAt": "2026-09-10T21:51:39.000Z"
    }
  ]
}
```

| Field | Why it is there |
|---|---|
| `realmId` | The pipeline's key for a client. Stable, unlike company names, which are editable and sometimes wrong |
| `companyName` | For alert messages and human eyes. `null` until the name has been fetched once |
| `connectionId` | So a support question can be matched against a log line |
| `status` | `ok` or `needs_reconnect`. See below — it is a hint, not a guarantee |
| `connectedAt`, `lastRefreshAt` | Freshness, as ISO strings. The database holds epoch milliseconds; convert at this boundary so a caller in another language does not have to guess units |

**Deliberately dropped: `email`.** `connectionStore.listSummaries()` returns it, and the
response must not. It is the address of the teammate who authorized the connection, the
pipeline has no use for it, and the safest field is one that is never sent. There is a
test for this below rather than only a note here.

**Wrapped in an object, not returned as a bare array,** so that adding a field later —
paging, a generated-at stamp — is not a breaking change for a caller already in
production.

### One entry per company, and which connection wins

Several teammates can connect the same company, so the table holds several rows for one
realm. The pipeline should not have to choose between them, so the endpoint does:

> **Group by `realm_id`. Within a realm prefer rows where `email_verified` is 1, and among
> those take the greatest `refresh_updated_at`. Emit one entry per realm either way.**

Put that in a pure function — `src/api/connections-logic.ts`, taking the
`ConnectionSummaryRow[]` the store already returns and giving back one entry per realm —
so it can be tested without Express or a database. **Step 2 must resolve a report request
to a connection by exactly the same rule**, so it belongs in one place from the start.

### What `status` actually means

There is no "revoked" column to read, so the status has to be inferred. Two signals are
available and both are worth using:

1. **No verified row for the realm.** Every connection made since the Google gate shipped
   is verified; an unverified row predates it and should be reconnected.
2. **A stale refresh.** Intuit's refresh tokens last about a hundred days and are renewed
   on use. A connection whose `refresh_updated_at` is older than **90 days** is almost
   certainly dead, and the conservative threshold means we flag it shortly before it
   fails rather than after.

Either condition yields `needs_reconnect`. Put the 90 days in a named constant next to
the logic, with a comment pointing at Intuit's hundred-day figure, because the number is
not self-explanatory.

**This is a hint.** Whether Intuit still honours a credential is only knowable by using
it. In step 2 a report call answering 409 is the authoritative signal; the pipeline should
read this field as "worth alerting a human about", never as "will definitely fail".

## Logging

One line per request on `res.on("finish")`, mirroring the `mcp_request` line in
`src/transport.ts` field for field where the fields have counterparts:

```ts
log.info(
  { principal, method: req.method, path: req.path, status: res.statusCode, ms },
  "api_request",
);
```

`mcp_request` carries `connectionId` and `email`; this one carries `principal` instead,
since there is no person behind the call. Add `realm` once step 2 has requests that name
one.

**Never log the token, in any form** — not the value, not a prefix, not its length, and
not on a rejection. A rejection logs the reason and `req.ip`, which is enough to tell a
misconfigured job apart from someone probing.

## Files

| File | Change |
|---|---|
| `src/config/env.ts` | The two variables above |
| `src/api/auth.ts` | **new** — `requireServicePrincipal`, `secretMatches`, the principal rate limiter, the `Request` augmentation |
| `src/api/connections-logic.ts` | **new** — pure: summary rows in, one entry per realm out |
| `src/api/connections.ts` | **new** — the handler; maps the pure result to the response shape and drops `email` |
| `src/api/index.ts` | **new** — an Express router carrying the middleware and the route |
| `src/index.ts` | Mount it when `env.SERVICE_TOKEN` is set, and scope CORS (below) |
| `DEPLOY.md` | The two variables, generating the secret, rotating it |
| `README.md` | A row in the environment table |

**Where to mount it.** After the `/health` and root handlers, before `mcpAuthRouter`.
That router is mounted at the app root and claims a broad set of paths; `/api` should be
matched by its own router rather than depending on that one not catching it.

## Tests

`src/api/__tests__/auth.test.ts` — an Express app with the router mounted, driven over a
real port, the way `src/__tests__/transport.test.ts` already does it.

| Test | What it proves |
|---|---|
| A correct token reaches the handler | The happy path |
| A wrong token of the same length is 401 | The basic gate |
| A wrong token of a *different* length is 401, not a crash | The hashed comparison. A naive `timingSafeEqual` throws here |
| No header is 401 and sets `WWW-Authenticate` | Callers are told how to authenticate |
| `Authorization: Token abc` is 401 | Only `Bearer` is accepted |
| The 301st request in a minute is 429 with `Retry-After` | The limiter is wired and the header is set |
| No captured log payload contains the token | Assert it, including on the rejection paths |

`src/api/__tests__/connections-logic.test.ts` — pure, no server, no database:

| Test | What it proves |
|---|---|
| Two rows for one realm collapse to one entry | The pipeline never has to choose |
| A verified row beats an unverified one whatever the dates | Verification outranks recency |
| Among verified rows the greatest `refresh_updated_at` wins | The tie-break |
| A realm with only unverified rows is returned once, `needs_reconnect` | The company is surfaced, not hidden |
| A refresh older than 90 days is `needs_reconnect` | The staleness rule, with an injected `now` |
| A refresh 89 days old is `ok` | The boundary, in the other direction |
| No rows gives an empty list | No crash on a fresh database |

The staleness tests need a clock, so give the function an explicit `now` parameter with a
`Date.now()` default — `RateLimiter.check` and `oauthStore.purgeExpired` already set that
convention in this codebase.

`src/api/__tests__/connections.test.ts`:

| Test | What it proves |
|---|---|
| The response body contains no `email` key and no address-shaped value | The dropped field, asserted rather than assumed |
| Dates come back as ISO strings, not numbers | The stable contract for a caller in another language |

## Done when

1. `mise x node@22 -- pnpm typecheck && mise x node@22 -- pnpm test` pass, with the tests above present.
2. With `SERVICE_TOKEN` unset, `GET /api/connections` returns 404.
3. With it set, a correct token returns the list and a wrong one returns 401.
4. Production logs show `api_request` lines, and no token appears anywhere in them.
5. `DEPLOY.md` documents both variables and the rotation procedure.

## Rotating, and what to do if it leaks

Rotation is a variable change with no deploy: set a new `SERVICE_TOKEN` in Railway, then
update the pipeline's copy. Between the two the pipeline's next call fails with 401. A
monthly job simply runs late, which is why this does not justify building overlapping-secret
support.

If the secret leaks, clearing `SERVICE_TOKEN` removes the entire `/api` surface on the next
boot. The blast radius is bounded by what the door can do: read a report from a company
that is already connected. No credential is exposed, nothing can be written, and neither
the MCP surface nor anyone's own session is affected.

## The hard rule

**This door is read-only permanently.** No endpoint that changes a client's books is ever
added to `/api`, whatever the server's Claude tools grow later. Writes have a different
threat model — they need a named human approving a specific batch, with a record of who
approved it — and a shared secret held by a machine cannot satisfy that.

## One piece of hardening to do at the same time

The CORS middleware in `src/index.ts` runs on every request and sets
`Access-Control-Allow-Origin: *` on every response, `/api` included once it exists. It was
written for browser-based MCP clients, and only `/mcp` has a preflight handler, so the
headers on other paths do nothing useful.

This is not a vulnerability: the door takes a bearer rather than a cookie, and a browser
will not attach one on its own. But there is no reason to advertise a cross-origin policy
on a machine-to-machine endpoint. Scope that middleware to `/mcp` while the file is open.
