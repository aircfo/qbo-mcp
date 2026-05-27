import type { RequestHandler } from "express";
import { intuitOAuth, oauthStore } from "../deps.js";
import { log } from "../log.js";
import { renderConnectPage } from "./connect-page.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Handles the connect-page form submit. This runs OUTSIDE the SDK's validated
 * /authorize handler, so it re-validates the OAuth params itself (client must
 * exist; redirect_uri must be one the client registered; PKCE challenge
 * present) before minting the pending-auth and forwarding to Intuit.
 */
export const connectStartHandler: RequestHandler = (req, res) => {
  const clientId = str(req.body.client_id);
  const redirectUri = str(req.body.redirect_uri);
  const codeChallenge = str(req.body.code_challenge);
  const mcpState = str(req.body.state) || undefined;
  const email = str(req.body.email).trim();
  const ack = str(req.body.ack) === "yes";

  // Re-validate the OAuth request. Failures here can't be safely redirected, so
  // they render an error rather than bouncing to an unvalidated redirect_uri.
  const client = clientId
    ? oauthStore.clientsStore.getClient(clientId)
    : undefined;
  const clientInfo = client instanceof Promise ? undefined : client;
  if (!clientInfo || !codeChallenge) {
    res
      .status(400)
      .type("html")
      .send("Invalid or expired authorization request. Please start over.");
    return;
  }
  if (!clientInfo.redirect_uris.includes(redirectUri)) {
    res.status(400).type("html").send("Unregistered redirect URI.");
    return;
  }

  // User-fixable input errors re-render the page with a message.
  const rerender = (error: string): void => {
    res
      .status(400)
      .type("html")
      .send(
        renderConnectPage({
          clientId,
          redirectUri,
          codeChallenge,
          mcpState,
          email,
          error,
        }),
      );
  };
  if (!EMAIL_RE.test(email)) {
    rerender("Please enter a valid email address.");
    return;
  }
  if (!ack) {
    rerender("Please check the acknowledgment to continue.");
    return;
  }

  const state = oauthStore.createPendingAuth({
    clientId,
    redirectUri,
    codeChallenge,
    scopes: [],
    mcpState,
    email,
    termsAcceptedAt: Date.now(),
  });

  log.info({ clientId, email }, "connect_started");
  res.redirect(intuitOAuth.authorizeUri(state));
};
