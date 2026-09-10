import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";

/**
 * Google as the identity provider — used ONLY to establish who the caller is
 * at connect time, never to read Google data. The scopes are the cheap
 * identity ones, and the address comes from the signed `id_token` rather than
 * a userinfo call, so nothing here trusts an unverified response body.
 *
 * The @domain + allowlist decision belongs to the caller (see access.ts).
 */
const SCOPES = ["openid", "email", "profile"];

/** Must match the redirect URI registered on the Google OAuth client exactly. */
export function googleRedirectUri(): string {
  return `${env.PUBLIC_URL}/oauth/google/callback`;
}

function client(): OAuth2Client {
  return new OAuth2Client(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    googleRedirectUri(),
  );
}

/**
 * Where to send someone to prove who they are. `hd` is a hint to Google's
 * account chooser, not a control — the gate in access.ts is what enforces the
 * domain.
 */
export function googleAuthUrl(state: string): string {
  return client().generateAuthUrl({
    scope: SCOPES,
    state,
    access_type: "online",
    prompt: "select_account",
    hd: env.ALLOWED_DOMAIN,
  });
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
}

/**
 * Exchange the callback code for tokens and verify the returned `id_token`'s
 * signature and audience with Google. Throws when Google returns no id_token
 * or the token carries no email.
 */
export async function verifyGoogleCode(code: string): Promise<GoogleIdentity> {
  const oauth = client();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.id_token) throw new Error("Google returned no id_token");

  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("Google id_token carries no email");

  return {
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
  };
}
