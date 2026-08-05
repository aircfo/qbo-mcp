import express, { type ErrorRequestHandler } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { env } from "./config/env.js";
import { oauthProvider } from "./deps.js";
import { SCOPE } from "./auth/provider.js";
import { connectStartHandler } from "./auth/connect-start.js";
import { intuitCallbackHandler } from "./auth/intuit-callback.js";
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
app.use((_req, res, next) => {
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

// A bare visit to the server root (e.g. someone inspecting the connector URL)
// lands on the user guide instead of a 404.
app.get("/", (_req, res) => {
  res.redirect(env.DOCS_URL);
});

// Connect-page form submit (collects email, then forwards to Intuit). Needs
// urlencoded body parsing for the HTML form post.
app.post(
  "/connect/start",
  express.urlencoded({ extended: false, limit: "16kb" }),
  connectStartHandler,
);

// Where Intuit redirects after the user grants consent. Not part of the MCP
// OAuth surface — it's our upstream callback that creates the connection.
app.get("/oauth/intuit/callback", intuitCallbackHandler);

// MCP OAuth server endpoints: metadata discovery, dynamic client registration,
// /authorize, /token, /revoke. Must be mounted at the app root.
const baseUrl = new URL(env.PUBLIC_URL);
app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: baseUrl,
    baseUrl,
    resourceName: "airCFO QuickBooks",
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

app.listen(env.PORT, () => {
  log.info(
    { port: env.PORT, intuitEnv: env.INTUIT_ENVIRONMENT },
    "server_listening",
  );
});
