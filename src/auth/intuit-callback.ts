import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import {
  clientManager,
  connectionStore,
  intuitOAuth,
  oauthStore,
} from "../deps.js";
import { log } from "../log.js";
import { asRecord, promisify, withTimeout } from "../tools/_format.js";
import { reconcileConnection } from "./connection-reconcile.js";
import { confirmPage, errorPage } from "./pages.js";

/** Bound so a slow CompanyInfo call cannot stall the connect flow. */
const COMPANY_NAME_TIMEOUT_MS = 8_000;

/**
 * Best-effort company name for the confirmation page, cached on the row while
 * we have it.
 *
 * The page is the whole point of this step, and "you connected realm
 * 719325880" is not something a person can check. A name is. So this call is
 * worth making here even though the same column is also filled lazily on the
 * first `get_company_info` — and it is best-effort, because a person can still
 * confirm against the realm if Intuit is slow.
 */
async function captureCompanyName(
  connectionId: string,
): Promise<string | null> {
  try {
    const { qb, realmId } = await clientManager.getClient(connectionId);
    const info = asRecord(
      await withTimeout(
        () => promisify((cb) => qb.getCompanyInfo(realmId, cb)),
        COMPANY_NAME_TIMEOUT_MS,
        "QuickBooks company lookup",
      ),
    );
    const name =
      typeof info?.CompanyName === "string" ? info.CompanyName : null;
    if (name) connectionStore.setCompanyName(connectionId, name);
    return name;
  } catch (err) {
    log.warn({ connectionId, err: String(err) }, "company_name_lookup_failed");
    return null;
  }
}

/**
 * Intuit's OAuth redirect lands here, after Google has already established who
 * the caller is. This exchanges Intuit's code, stores the connection, and then
 * stops: the MCP client gets no authorization code until the person confirms,
 * on the next page, that this is the company they meant.
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

  // Identity is set by the Google leg. Reaching here without it means the
  // Intuit state was minted some other way, so refuse rather than fall back to
  // an anonymous connection.
  if (!pending.email || pending.emailVerified !== true) {
    log.warn({ clientId: pending.clientId }, "intuit_callback_unverified");
    res
      .status(400)
      .type("html")
      .send(errorPage("Please start the connection again and sign in first."));
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

    const { connectionId, reused } = await reconcileConnection(
      {
        connections: connectionStore,
        revokeIntuitToken: (token) => intuitOAuth.revoke(token),
        onRevokeFailed: (err, id) =>
          log.warn(
            { connectionId: id, err: String(err) },
            "intuit_revoke_failed",
          ),
      },
      {
        realmId: tokens.realmId,
        email: pending.email,
        emailVerified: true,
        termsAcceptedAt: pending.termsAcceptedAt ?? null,
        accessToken: tokens.accessToken,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshToken: tokens.refreshToken,
      },
    );
    log.info(
      {
        connectionId,
        realmId: tokens.realmId,
        email: pending.email,
        reused,
      },
      "connection_created",
    );

    const companyName = await captureCompanyName(connectionId);
    const confirmToken = oauthStore.createPendingConfirm({
      connectionId,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      mcpState: pending.mcpState,
      created: !reused,
    });

    res.type("html").send(
      confirmPage({
        token: confirmToken,
        companyName,
        realmId: tokens.realmId,
        environment: env.INTUIT_ENVIRONMENT,
        email: pending.email,
      }),
    );
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
