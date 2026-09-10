import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { intuitOAuth, oauthStore } from "../deps.js";
import { log } from "../log.js";
import { isAllowedUser } from "./access.js";
import { type GoogleIdentity, verifyGoogleCode } from "./google-idp.js";
import { deniedPage, errorPage } from "./pages.js";

/**
 * Where Google returns after sign-in, and the only place identity is
 * established. On success the verified address is attached to the parked
 * authorization and the caller continues to Intuit; on refusal the flow stops
 * here and never reaches QuickBooks.
 *
 * The verifier is injectable so the gate's behaviour can be tested without
 * talking to Google.
 */
export function googleCallbackHandler(
  verify: (code: string) => Promise<GoogleIdentity> = verifyGoogleCode,
): RequestHandler {
  return async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";

    // A failure before this point cannot be redirected anywhere safe: the
    // pending record is what names the client's redirect_uri, and without it
    // there is nowhere to send an error that we have validated.
    const pending = state ? oauthStore.consumePendingAuth(state) : null;
    if (!pending) {
      res
        .status(400)
        .type("html")
        .send(errorPage("This sign-in link has expired. Please start over."));
      return;
    }
    if (!code) {
      res
        .status(400)
        .type("html")
        .send(errorPage("Google did not return a sign-in code."));
      return;
    }

    let identity: GoogleIdentity;
    try {
      identity = await verify(code);
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.stack : String(err) },
        "google_verify_failed",
      );
      res
        .status(502)
        .type("html")
        .send(
          errorPage(
            "Couldn't verify your Google sign-in. Please try connecting again.",
          ),
        );
      return;
    }

    if (!isAllowedUser(identity.email, identity.emailVerified)) {
      log.warn(
        {
          email: identity.email,
          emailVerified: identity.emailVerified,
          clientId: pending.clientId,
        },
        "login_denied",
      );
      res
        .status(403)
        .type("html")
        .send(deniedPage(identity.email, env.ALLOWED_DOMAIN));
      return;
    }

    // Re-park the request with the verified identity attached, and hand the
    // new state to Intuit. Each state is single-use, so the Google leg cannot
    // be replayed to mint a second Intuit consent.
    // `termsAcceptedAt` is deliberately left unset: it recorded the
    // acknowledgment checkbox on the public connect page, and that page is
    // gone. The column stays for the rows that have one.
    const intuitState = oauthStore.createPendingAuth({
      ...pending,
      email: identity.email,
      emailVerified: true,
    });

    log.info(
      { email: identity.email, clientId: pending.clientId },
      "login_succeeded",
    );
    res.redirect(intuitOAuth.authorizeUri(intuitState));
  };
}
