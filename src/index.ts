import express, { type ErrorRequestHandler } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { env } from "./config/env.js";
import { oauthProvider } from "./deps.js";
import { connectStartHandler } from "./auth/connect-start.js";
import { intuitCallbackHandler } from "./auth/intuit-callback.js";
import { log } from "./log.js";
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
app.use(express.json());

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

// Connect-page form submit (collects email, then forwards to Intuit). Needs
// urlencoded body parsing for the HTML form post.
app.post(
  "/connect/start",
  express.urlencoded({ extended: false }),
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
    resourceName: "QuickBooks Online MCP",
  }),
);

// The MCP transport itself, gated by an OAuth bearer (verified by our provider).
const requireAuth = requireBearerAuth({ verifier: oauthProvider });
app.post("/mcp", requireAuth, handleMcpPost);
app.get("/mcp", requireAuth, handleMcpGet);
app.delete("/mcp", requireAuth, handleMcpDelete);

// Final error handler: a thrown/rejected handler returns a clean 500 and a log
// line instead of hanging the request or bubbling into the process.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  log.error(
    { path: req.path, err: err instanceof Error ? err.stack : String(err) },
    "request_error",
  );
  if (!res.headersSent) res.status(500).json({ error: "internal_error" });
};
app.use(errorHandler);

startSessionReaper();

app.listen(env.PORT, () => {
  log.info(
    { port: env.PORT, intuitEnv: env.INTUIT_ENVIRONMENT },
    "server_listening",
  );
});
