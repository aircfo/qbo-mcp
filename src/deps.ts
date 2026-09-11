import { env } from "./config/env.js";
import { QboClientManager } from "./qbo/client-manager.js";
import { IntuitOAuth } from "./qbo/intuit-oauth.js";
import { OAuthStore } from "./auth/oauth-store.js";
import { QboOAuthProvider } from "./auth/provider.js";
import { ConnectionStore } from "./store/connection-store.js";
import { TokenCipher } from "./store/crypto.js";
import { openDatabase } from "./store/db.js";

/**
 * Composition root. Everything env-derived and long-lived is wired here once,
 * so the rest of the code depends on instances rather than reaching for env or
 * constructing its own database handle. Unit tests build their own instances.
 */
const db = openDatabase(env.DATABASE_PATH);
const cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY);

export const connectionStore = new ConnectionStore(db, cipher);
export const oauthStore = new OAuthStore(db);
export const intuitOAuth = new IntuitOAuth();
export const clientManager = new QboClientManager(connectionStore, intuitOAuth);
export const oauthProvider = new QboOAuthProvider(oauthStore, connectionStore);
