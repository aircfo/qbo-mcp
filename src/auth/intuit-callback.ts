import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { connectionStore, intuitOAuth, oauthStore } from "../deps.js";
import { log } from "../log.js";

function errorPage(message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#fff0f0">
    <h2 style="color:#d32f2f">Couldn't connect QuickBooks</h2>
    <p>${message}</p>
  </body></html>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shown after the QuickBooks connection is created, instead of a blind 302 back
 * to the MCP client's loopback. The redirect *destination* (the desktop app's
 * local listener) is outside our control and can be unreachable at this instant
 * — a blind 302 then dead-ends the browser on a raw "can't connect" error. So
 * we render a success page first (top-level meta-refresh auto-attempts the
 * handoff after a beat, which Safari handles more reliably than an auto-302),
 * keep a user-clickable link, and reassure the user the connection already
 * succeeded even if the redirect itself errors.
 */
function successPage(redirectUrl: string): string {
  const safeUrl = escapeAttr(redirectUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2;url=${safeUrl}" />
  <title>QuickBooks connected</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
  <main style="background:#fff;max-width:420px;width:90%;padding:32px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1);text-align:center">
    <div style="font-size:40px;line-height:1">✅</div>
    <h1 style="font-size:20px;margin:12px 0 8px">QuickBooks connected</h1>
    <p style="color:#555;font-size:14px;margin:0 0 24px">Returning you to Claude…</p>
    <a href="${safeUrl}"
      style="display:inline-block;width:100%;box-sizing:border-box;padding:12px;font-size:15px;font-weight:600;color:#fff;background:#2ca01c;border-radius:8px;text-decoration:none">
      Return to Claude
    </a>
    <p style="color:#888;font-size:12px;margin:20px 0 0">
      If this page shows a connection error, your QuickBooks connection still succeeded — go back to Claude and try your request again.
    </p>
  </main>
</body>
</html>`;
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
      email: pending.email ?? null,
      termsAcceptedAt: pending.termsAcceptedAt ?? null,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshToken: tokens.refreshToken,
    });
    log.info(
      { connectionId, realmId: tokens.realmId, email: pending.email },
      "connection_created",
    );

    const authCode = oauthStore.issueAuthCode({
      clientId: pending.clientId,
      connectionId,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", authCode);
    if (pending.mcpState) redirect.searchParams.set("state", pending.mcpState);
    res.type("html").send(successPage(redirect.toString()));
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.stack : String(err) },
      "intuit_callback_exchange_failed",
    );
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
