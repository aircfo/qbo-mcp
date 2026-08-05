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

  // Optional links surfaced on the connect page. When set, the acknowledgment
  // references them; when unset, the page shows a generic data-access notice.
  TERMS_URL: z.string().url().optional(),
  PRIVACY_URL: z.string().url().optional(),

  // Public user guide (GitHub Pages). Linked from the connect page and served
  // as the redirect target for the bare server root. Normalized to a trailing
  // slash because links are composed as `${DOCS_URL}page.html`.
  DOCS_URL: z
    .string()
    .url()
    .default("https://aircfo.github.io/qbo-mcp/")
    .transform((u) => (u.endsWith("/") ? u : `${u}/`)),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[config/env] Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = Object.freeze(parsed.data);
