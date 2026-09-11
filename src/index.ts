import express, { type ErrorRequestHandler } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { env } from "./config/env.js";
import { connectionStore, oauthProvider, oauthStore } from "./deps.js";
import { SCOPE } from "./auth/provider.js";
import {
  connectCancelHandler,
  connectConfirmHandler,
} from "./auth/connect-confirm.js";
import { googleCallbackHandler } from "./auth/google-callback.js";
import { intuitCallbackHandler } from "./auth/intuit-callback.js";
import { serviceApiRouter } from "./api/index.js";
import { log } from "./log.js";
import { RateLimiter } from "./rate-limit.js";
import {
  handleMcpDelete,
  handleMcpGet,
  handleMcpPost,
  startSessionReaper,
} from "./transport.js";

// Process-level safety nets. A stray rejection should be logged, not silently
// swallowed; a truly uncaught exception leaves the process in an unknown state,
// so we log and exit and let Railway restart us cleanly (tokens live on the
// volume, so a restart never forces users to reconnect).
process.on("unhandledRejection", (reason) => {
  log.error(
    { reason: reason instanceof Error ? reason.stack : String(reason) },
    "unhandled_rejection",
  );
});
process.on("uncaughtException", (err) => {
  log.error({ err: err.stack ?? String(err) }, "uncaught_exception");
  process.exit(1);
});

const app = express();

// Behind Railway's proxy: trust one hop so req.ip / protocol reflect the client.
app.set("trust proxy", 1);

// Per-IP backstop against abuse of the public, unauthenticated surface (the
// per-connection limit in transport.ts is the finer control for tool calls).
// Generous, since teammates may share an office IP; this is a DoS guard, not
// fine-grained throttling. /health is exempt for Railway's probe.
const ipLimiter = new RateLimiter(600, 60_000);
setInterval(() => ipLimiter.sweep(), 5 * 60_000).unref();
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const { allowed, retryAfterMs } = ipLimiter.check(req.ip ?? "unknown");
  if (!allowed) {
    res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
    res.status(429).json({ error: "rate_limited" });
    return;
  }
  next();
});

// Cap request bodies so a malicious client can't OOM us with a huge payload.
app.use(express.json({ limit: "256kb" }));

// CORS for browser-based MCP clients. Inlined to avoid a dependency.
//
// Applies everywhere except /api. A browser client needs these headers on far
// more than the /mcp transport: mcpAuthRouter serves discovery, registration,
// /authorize, /token and /revoke from the app root, and a browser fetches
// those cross-origin before it ever holds a bearer. Narrowing this to /mcp
// would break claude.ai and Cowork at the discovery step. /api is excluded
// because it is machine-to-machine — it takes a bearer rather than a cookie,
// and has no reason to advertise a cross-origin policy.
app.use((req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) return next();
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, mcp-session-id, mcp-protocol-version",
  );
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
  next();
});
app.options("/mcp", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// A bare visit to the server root — usually someone inspecting the connector
// URL. There is nothing here for the public any more.
app.get("/", (_req, res) => {
  res
    .type("html")
    .send(
      "<p style=\"font-family:system-ui;padding:2rem\">airCFO QBO Gateway — an internal connector. Nothing to see here.</p>",
    );
});

// The connect flow, in order: Google establishes who the caller is, Intuit
// grants access to a company, and the confirmation step is where the MCP
// client finally receives its authorization code.
app.get("/oauth/google/callback", googleCallbackHandler());
app.get("/oauth/intuit/callback", intuitCallbackHandler);

const connectForm = express.urlencoded({ extended: false, limit: "16kb" });
app.post("/connect/confirm", connectForm, connectConfirmHandler);
app.post("/connect/cancel", connectForm, connectCancelHandler);

// The service door for scheduled jobs, mounted only when a token is
// configured — so with no token these paths 404 rather than existing and
// refusing. Ahead of mcpAuthRouter, which is mounted at the app root and
// claims a broad set of paths.
if (env.SERVICE_TOKEN) {
  app.use(
    "/api",
    serviceApiRouter({
      token: env.SERVICE_TOKEN,
      principalId: env.SERVICE_PRINCIPAL_ID,
      connections: connectionStore,
    }),
  );
  log.info({ principal: env.SERVICE_PRINCIPAL_ID }, "service_api_enabled");
}

// MCP OAuth server endpoints: metadata discovery, dynamic client registration,
// /authorize, /token, /revoke. Must be mounted at the app root.
const baseUrl = new URL(env.PUBLIC_URL);
app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: baseUrl,
    baseUrl,
    resourceName: "airCFO QBO Gateway",
    scopesSupported: [SCOPE],
  }),
);

// The MCP transport itself, gated by an OAuth bearer (verified by our provider).
const requireAuth = requireBearerAuth({ verifier: oauthProvider });
app.post("/mcp", requireAuth, handleMcpPost);
app.get("/mcp", requireAuth, handleMcpGet);
app.delete("/mcp", requireAuth, handleMcpDelete);

// Final error handler. Preserves a client-error status the middleware set
// (e.g. body-parser's 413 for an oversized payload); otherwise 500. Either way
// it returns a clean JSON body and a log line instead of hanging the request.
function statusOf(err: unknown): number {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
  }
  return 500;
}
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = statusOf(err);
  const fields = {
    path: req.path,
    status,
    err: err instanceof Error ? err.stack : String(err),
  };
  if (status >= 500) log.error(fields, "request_error");
  else log.warn(fields, "request_rejected");
  if (!res.headersSent) {
    res
      .status(status)
      .json({ error: status >= 500 ? "internal_error" : "request_rejected" });
  }
};
app.use(errorHandler);

startSessionReaper();

// Nothing pruned the token table before, so it kept every access token ever
// issued. Sweep hourly, keeping a week of expired rows so they are still there
// when someone reads back a connect attempt from the logs.
const TOKEN_RETENTION_MS = 7 * 24 * 60 * 60_000;
setInterval(
  () => {
    const removed = oauthStore.purgeExpired(TOKEN_RETENTION_MS);
    if (removed > 0) log.info({ removed }, "oauth_tokens_purged");
  },
  60 * 60_000,
).unref();

app.listen(env.PORT, () => {
  log.info(
    { port: env.PORT, intuitEnv: env.INTUIT_ENVIRONMENT },
    "server_listening",
  );
});
