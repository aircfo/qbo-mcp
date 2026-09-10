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
   *Generate Domain*. Copy it, e.g. `https://qbo-mcp-production.up.railway.app`.
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
