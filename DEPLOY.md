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

   **Do not set `PORT`** — Railway injects it and the app reads it.
   `TOKEN_ENCRYPTION_KEY` must stay **stable**: rotating it makes every stored
   connection undecryptable (users would have to reconnect QuickBooks).

5. **Register the redirect URI with Intuit.** In the Intuit developer portal →
   your app → *Keys & OAuth* → Redirect URIs, add
   `<PUBLIC_URL>/oauth/intuit/callback` exactly. Use the **sandbox** keys to test
   the deployed flow first; switch to **production** keys (and
   `INTUIT_ENVIRONMENT=production`) when you go live.

6. **Redeploy** so the env vars take effect, then smoke-test:
   `curl https://<domain>/health` → `{"status":"ok"}`.

## Connecting a client

```sh
claude mcp add qbo-prod --transport http https://<domain>/mcp
```

Then in a fresh Claude Code session: `/mcp` → `qbo-prod` → *Authenticate* →
grant consent in the browser → call `get_company_info`.

## Notes

- The `/health` endpoint is unauthenticated and used by Railway's healthcheck.
- Tokens persist across deploys (they're on the volume), so redeploys don't force
  users to reconnect — as long as `TOKEN_ENCRYPTION_KEY` is unchanged.
