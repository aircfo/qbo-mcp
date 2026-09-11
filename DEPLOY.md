# Deploying to Railway

This server is a single long-running process backed by an encrypted SQLite file
on a **persistent volume**. It runs from the `Dockerfile` (Railway auto-detects
it via `railway.json`).

## Why a volume (and one replica)

The SQLite file holds every user's encrypted QuickBooks tokens. A Railway volume
attaches to **one** instance, so keep the service at **1 replica** (set in
`railway.json`). If you ever need to scale horizontally, that's the point to
switch to Railway Postgres — until then, one instance is the design.

## One-time setup

1. **Create the project.** Railway → New Project → *Deploy from GitHub repo* →
   pick this repo. Railway detects the Dockerfile and starts the first build.

2. **Add a volume.** Service → *Volumes* → New Volume → mount path **`/data`**.

3. **Generate a public domain.** Service → Settings → *Networking* →
   *Generate Domain*. Copy the domain Railway shows you — it is unique to the
   service, and a guessed hostname may belong to someone else's app.
   (You need this before the next step.)

4. **Set environment variables** (service → *Variables*):

   | Variable | Value |
   |---|---|
   | `PUBLIC_URL` | the generated domain, **no trailing slash** |
   | `DATABASE_PATH` | `/data/qbo-mcp.db` (must live under the volume mount) |
   | `TOKEN_ENCRYPTION_KEY` | a **new** `openssl rand -base64 32` (distinct from local) |
   | `INTUIT_CLIENT_ID` | from your Intuit app |
   | `INTUIT_CLIENT_SECRET` | from your Intuit app |
   | `INTUIT_REDIRECT_URI` | `<PUBLIC_URL>/oauth/intuit/callback` |
   | `INTUIT_ENVIRONMENT` | `sandbox` or `production` |
   | `GOOGLE_OAUTH_CLIENT_ID` | from the Google OAuth client (below) |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | from the same client |
   | `ALLOWED_DOMAIN` | `aircfo.com` |
   | `ALLOWED_USERS` | `*` for any verified address on the domain, or a comma-separated list. **Empty admits nobody** |
   | `ADMIN_USERS` | comma-separated addresses that get the administrative tools |
   | `SERVICE_TOKEN` | **optional** — `openssl rand -base64 48`. Enables the read-only `/api` door for scheduled jobs. Leave unset until a job needs it |
   | `SERVICE_PRINCIPAL_ID` | optional — names that caller in the logs (default `svc:actuals-pipeline`) |

   **Do not set `PORT`** — Railway injects it and the app reads it.
   `TOKEN_ENCRYPTION_KEY` must stay **stable**: rotating it makes every stored
   connection undecryptable (users would have to reconnect QuickBooks).

5. **Create the Google OAuth client.** In the same Google Cloud project as
   `aircfo-mcp`: *APIs & Services* → *Credentials* → *Create credentials* →
   *OAuth client ID* → **Web application**, user type **Internal**. Add the
   redirect URI `<PUBLIC_URL>/oauth/google/callback`, plus
   `http://localhost:8080/oauth/google/callback` for local work. No scopes to
   configure: the server requests `openid email profile` and reads the verified
   `id_token`, never Google data.

6. **Register the redirect URI with Intuit.** In the Intuit developer portal →
   your app → *Keys & OAuth* → Redirect URIs, add
   `<PUBLIC_URL>/oauth/intuit/callback` exactly. Use the **sandbox** keys to test
   the deployed flow first; switch to **production** keys (and
   `INTUIT_ENVIRONMENT=production`) when you go live.

7. **Redeploy** so the env vars take effect, then smoke-test:
   `curl https://<domain>/health` → `{"status":"ok"}`.

## Local development, and where writes get proven

There is no deployed non-production environment: the "QBO MCP (Sandbox)" Railway
project was retired in September 2026. Local development against an **Intuit
sandbox company** replaces it, and is the better target anyway — no deploy
between edits, and a posted entry is inspectable in Intuit's own sandbox UI.

```sh
# .env
PUBLIC_URL=http://localhost:8080
INTUIT_REDIRECT_URI=http://localhost:8080/oauth/intuit/callback
INTUIT_ENVIRONMENT=sandbox      # routes to Intuit's sandbox APIs
DATABASE_PATH=./data/qbo-mcp.db # a separate database from production's
```

```sh
pnpm dev
claude mcp add qbo-local --transport http http://localhost:8080/mcp
```

Both localhost redirect URIs have to be registered — the Google one on the
OAuth client, the Intuit one on the Intuit app — and Intuit's **sandbox** keys
belong in the local `.env`, not the production ones.

**What local development cannot exercise:** the claude.ai connector flow, which
needs a public HTTPS URL and uses its own redirect
(`https://claude.ai/api/mcp/auth_callback`). Most of the team connects that way,
so a change to the connect flow should be re-checked in production by one person
before the rest of the team is told to reconnect.

## The service door (`/api`)

A scheduled job cannot sign in the way a person does, so it authenticates with
a single shared secret instead. **This is off until you turn it on:** with no
`SERVICE_TOKEN` set, the `/api` routes are never registered and those paths 404
like any other unknown URL.

**Turning it on.** Generate a secret with `openssl rand -base64 48`, set it as
`SERVICE_TOKEN` in Railway, and redeploy. Give the same value to the job that
needs it, through that job's own hosting configuration. It belongs in exactly
those two places — never in the repository, never in a `.env` that gets shared,
never pasted into a chat or a ticket.

Confirm it is live:

```sh
curl -H "Authorization: Bearer $SERVICE_TOKEN" https://<domain>/api/connections
```

You should get a list of companies with realm ids, names and freshness — and no
credentials, and not the address of whoever authorized each connection.

**What the door serves.** Two read-only endpoints:

| Endpoint | Returns |
|---|---|
| `GET /api/connections` | Every company the server can currently pull, one entry per company |
| `GET /api/reports/:report` | One report for one company |

`:report` is a fixed list — `profit-and-loss`, `balance-sheet`, `trial-balance`,
`general-ledger`. Parameters are the same ones the Claude tools use: `realm`
(required), `start_date`, `end_date`, `accounting_method`,
`summarize_column_by`, `format`, `max_rows`.

A report answers with three arrays, `columns`, `rows` and `totals`. **`totals`
carries amounts booked directly to a parent account, which appear in no row.**
A caller that sums `rows` alone reports less money than the client earned, and
the numbers look plausible.

Failures are codes a pipeline can act on rather than retry blindly: `404` means
that company has never been connected, `409` means its credential lapsed and
someone must reconnect it once, `502` means QuickBooks failed after this server
had already retried.

**Rotating it.** Set a new value in Railway, then update the job's copy. In
between, the job's next call fails with 401 and a monthly job simply runs late.
That is why there is no overlapping-secret machinery.

**If it leaks.** Clear `SERVICE_TOKEN` and redeploy: the whole `/api` surface
stops existing. The exposure is bounded by what the door can do, which is read a
report for a company that is already connected. No credential is exposed,
nothing can be written, and neither the MCP surface nor anyone's own session is
affected.

**The rule that does not change.** `/api` is read-only permanently. No endpoint
that changes a client's books is ever added to it, whatever the Claude tools
grow later — a write needs a named human approving that specific batch, and a
secret held by a machine cannot be that.

## Connecting a client

```sh
claude mcp add qbo-prod --transport http https://<domain>/mcp
```

Then in a fresh Claude Code session: `/mcp` → `qbo-prod` → *Authenticate*. The
browser walks three steps: sign in with your `@aircfo.com` Google account,
choose the company on Intuit's consent screen, then confirm the company name and
realm the page reports back. Call `connection_status` afterwards to see what the
session is bound to.

## Notes

- The `/health` endpoint is unauthenticated and used by Railway's healthcheck.
- Tokens persist across deploys (they're on the volume), so redeploys don't force
  users to reconnect — as long as `TOKEN_ENCRYPTION_KEY` is unchanged.
