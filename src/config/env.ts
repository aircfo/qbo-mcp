import { z } from "zod";

/**
 * Boot-time environment validation. A misconfigured deploy crashes here at
 * startup with a readable error rather than failing mysteriously on the first
 * request. The schema is the source of truth for what the server needs.
 */
function decodesTo32Bytes(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),

  // Public base URL of this server, no trailing slash — used to compose the
  // Intuit redirect URI and the MCP OAuth discovery documents. Half the call
  // sites would otherwise have to defensively strip a slash; reject it here.
  PUBLIC_URL: z
    .string()
    .url()
    .refine((s) => !s.endsWith("/"), {
      message: "PUBLIC_URL must not end with a trailing slash",
    }),

  // In prod this points at a Railway volume mount (e.g. /data/qbo-mcp.db); the
  // default is a project-relative file for local development.
  DATABASE_PATH: z.string().min(1).default("./data/qbo-mcp.db"),

  // 32 random bytes, base64-encoded (`openssl rand -base64 32`). Encrypts the
  // Intuit access/refresh tokens at rest. Rotating it invalidates every stored
  // connection — users must reconnect QuickBooks.
  TOKEN_ENCRYPTION_KEY: z.string().refine(decodesTo32Bytes, {
    message:
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)",
  }),

  INTUIT_CLIENT_ID: z.string().min(1),
  INTUIT_CLIENT_SECRET: z.string().min(1),
  INTUIT_REDIRECT_URI: z.string().url(),
  INTUIT_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),

  // Google is the identity provider: it proves who the caller is at connect
  // time, and nothing more. The gate reads the verified `id_token`; no Google
  // data is ever requested. Configure the client's redirect URI as
  // `<PUBLIC_URL>/oauth/google/callback`.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),

  // The Workspace domain an address must belong to.
  ALLOWED_DOMAIN: z.string().min(1).default("aircfo.com"),

  // Who may connect. Either the sentinel `*` — any verified address on
  // ALLOWED_DOMAIN — or an explicit comma-separated list.
  //
  // Empty denies everyone, deliberately: `*` has to be a visible choice, so
  // that a variable accidentally cleared during a deploy locks people out
  // rather than silently opening the server to a whole domain.
  ALLOWED_USERS: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),

  // A scheduled job cannot sign in, so it authenticates with this shared
  // secret instead. Optional on purpose: with no value the /api routes are
  // never mounted, so those paths 404 like any other unknown URL. A surface
  // that exists and rejects everything tells a prober that it exists.
  SERVICE_TOKEN: z
    .string()
    .min(32, "SERVICE_TOKEN must be at least 32 characters")
    .optional(),

  // Names the non-interactive caller in logs, where the MCP surface would log
  // a person's address. One principal today; a token-to-principal map is the
  // extension point if that changes.
  SERVICE_PRINCIPAL_ID: z.string().min(1).default("svc:actuals-pipeline"),

  // Who additionally gets the administrative tools (list/revoke connections,
  // enable writes). A subset of the people ALLOWED_USERS admits.
  ADMIN_USERS: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[config/env] Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = Object.freeze(parsed.data);
