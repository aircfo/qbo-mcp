import express from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { env } from "./config/env.js";
import { oauthProvider } from "./deps.js";
import { intuitCallbackHandler } from "./auth/intuit-callback.js";
import { handleMcpDelete, handleMcpGet, handleMcpPost } from "./transport.js";

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

app.listen(env.PORT, () => {
  console.log(`qbo-mcp listening on :${env.PORT} (${env.INTUIT_ENVIRONMENT})`);
});
