import type { RequestHandler } from "express";
import { connectionStore, intuitOAuth, oauthStore } from "../deps.js";
import { log } from "../log.js";
import { cancelledPage, errorPage, successPage } from "./pages.js";

function tokenFrom(body: unknown): string {
  const value = (body as { token?: unknown } | undefined)?.token;
  return typeof value === "string" ? value : "";
}

const EXPIRED =
  "This confirmation has expired. Please start the connection again.";

/**
 * "Yes, this is the right company" — the point at which the MCP client finally
 * gets its authorization code. Nothing before this page issued one, so
 * abandoning the flow leaves a connection nobody can drive.
 */
export const connectConfirmHandler: RequestHandler = (req, res) => {
  const pending = oauthStore.consumePendingConfirm(tokenFrom(req.body));
  if (!pending) {
    res.status(400).type("html").send(errorPage(EXPIRED));
    return;
  }

  const authCode = oauthStore.issueAuthCode({
    clientId: pending.clientId,
    connectionId: pending.connectionId,
    codeChallenge: pending.codeChallenge,
    redirectUri: pending.redirectUri,
  });

  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set("code", authCode);
  if (pending.mcpState) redirect.searchParams.set("state", pending.mcpState);

  log.info(
    { connectionId: pending.connectionId, clientId: pending.clientId },
    "connection_confirmed",
  );
  res.type("html").send(successPage(redirect.toString()));
};

/**
 * "Wrong company" — revoke the QuickBooks access this flow just obtained and
 * issue no authorization code.
 *
 * A connection this flow *created* is deleted. One it merely refreshed is left
 * in place: that row is a company this person already had connected, and their
 * other MCP clients resolve to it.
 */
export const connectCancelHandler: RequestHandler = async (req, res) => {
  const pending = oauthStore.consumePendingConfirm(tokenFrom(req.body));
  if (!pending) {
    res.status(400).type("html").send(errorPage(EXPIRED));
    return;
  }

  const connection = connectionStore.get(pending.connectionId);
  if (connection) {
    try {
      await intuitOAuth.revoke(connection.refreshToken);
    } catch (err) {
      // Proceed regardless: the local teardown is what stops this server from
      // using the grant, and it must not depend on Intuit being reachable.
      log.warn(
        { connectionId: pending.connectionId, err: String(err) },
        "intuit_revoke_failed",
      );
    }
  }

  if (pending.created) {
    oauthStore.revokeConnectionTokens(pending.connectionId);
    connectionStore.delete(pending.connectionId);
  }

  log.info(
    { connectionId: pending.connectionId, deleted: pending.created },
    "connection_cancelled",
  );
  res.type("html").send(cancelledPage());
};
