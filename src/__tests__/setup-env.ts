import { randomBytes } from "node:crypto";

/**
 * Test environment. `src/config/env.ts` validates at import time and exits the
 * process when a variable is missing, so anything that reaches env — directly
 * or through a transitive import — needs these set first.
 *
 * Values are placeholders: no test talks to Intuit, and the database is
 * in-memory. `??=` so a real shell value still wins.
 */
process.env.PUBLIC_URL ??= "https://qbo-mcp.test";
process.env.DATABASE_PATH ??= ":memory:";
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.INTUIT_CLIENT_ID ??= "test-client-id";
process.env.INTUIT_CLIENT_SECRET ??= "test-client-secret";
process.env.INTUIT_REDIRECT_URI ??=
  "https://qbo-mcp.test/oauth/intuit/callback";
process.env.INTUIT_ENVIRONMENT ??= "sandbox";
