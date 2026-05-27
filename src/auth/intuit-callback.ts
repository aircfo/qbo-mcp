import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { connectionStore, intuitOAuth, oauthStore } from "../deps.js";

function errorPage(message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#fff0f0">
    <h2 style="color:#d32f2f">Couldn't connect QuickBooks</h2>
    <p>${message}</p>
  </body></html>`;
}

/**
 * Intuit's OAuth redirect lands here. We match it to the pending MCP
 * authorization (via the opaque `state`), exchange Intuit's code for tokens +
 * realmId, persist the connection, then hand an authorization code back to the
 * MCP client by redirecting to its registered redirect_uri.
 */
export const intuitCallbackHandler: RequestHandler = async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";

  const pending = state ? oauthStore.consumePendingAuth(state) : null;
  if (!pending) {
    res
      .status(400)
      .type("html")
      .send(
        errorPage("This authorization link has expired. Please start over."),
      );
    return;
  }
  if (!code) {
    res
      .status(400)
      .type("html")
      .send(errorPage("QuickBooks did not return an authorization code."));
    return;
  }

  try {
    // intuit-oauth parses code + realmId out of the full callback URL.
    const tokens = await intuitOAuth.exchangeCode(
      `${env.PUBLIC_URL}${req.originalUrl}`,
    );
    if (!tokens.realmId) {
      res
        .status(400)
        .type("html")
        .send(
          errorPage("QuickBooks did not identify a company (missing realmId)."),
        );
      return;
    }

    const connectionId = connectionStore.create({
      realmId: tokens.realmId,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshToken: tokens.refreshToken,
    });

    const authCode = oauthStore.issueAuthCode({
      clientId: pending.clientId,
      connectionId,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", authCode);
    if (pending.mcpState) redirect.searchParams.set("state", pending.mcpState);
    res.redirect(redirect.toString());
  } catch (err) {
    console.error("[intuit-callback] token exchange failed:", err);
    res
      .status(502)
      .type("html")
      .send(
        errorPage(
          "Failed to exchange the QuickBooks authorization code. Please try again.",
        ),
      );
  }
};
