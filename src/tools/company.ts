import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "../config/env.js";
import { connectionStore } from "../deps.js";
import { asRecord, json, promisify, toolError } from "./_format.js";
import { runQbo } from "./_shared.js";

/**
 * What this server knows about the caller's connection without asking Intuit
 * anything: which company it is bound to, who authorized it, and when.
 */
interface ConnectionSummary {
  realmId: string;
  environment: "sandbox" | "production";
  companyName: string | null;
  connectedBy: {
    email: string | null;
    /**
     * Self-reported at connect time and never checked. Becomes a verified
     * Google identity when sign-in moves to @aircfo.com accounts.
     */
    verified: boolean;
  };
  connectedAt: string;
  lastRefreshAt: string;
  writesEnabled: boolean;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function summarize(
  connection: NonNullable<ReturnType<typeof connectionStore.get>>,
): ConnectionSummary {
  return {
    realmId: connection.realmId,
    environment: env.INTUIT_ENVIRONMENT,
    companyName: connection.companyName,
    connectedBy: { email: connection.email, verified: false },
    connectedAt: iso(connection.createdAt),
    lastRefreshAt: iso(connection.refreshUpdatedAt),
    writesEnabled: false,
  };
}

export function registerCompanyTools(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    "get_company_info",
    {
      description:
        "Get the connected QuickBooks company's profile: legal/display name, address, fiscal-year start, country, and base currency. " +
        "Also returns a `connection` object naming the realm id (QuickBooks' own company identifier), the environment, and who authorized this connection — so an identity check can compare the realm rather than trusting a company name. " +
        "Use connection_status instead when you only need those, or when QuickBooks itself is unreachable.",
    },
    async () =>
      runQbo(
        connectionId,
        async (qb, realmId) => {
          const info =
            asRecord(await promisify((cb) => qb.getCompanyInfo(realmId, cb))) ??
            {};

          // Backfill the cached company name on first read. Doing it here
          // rather than during the connect flow keeps a slow Intuit call out
          // of the OAuth round trip, and self-heals every connection that
          // predates the column being populated.
          const name =
            typeof info.CompanyName === "string" ? info.CompanyName : null;
          const connection = connectionStore.get(connectionId);
          if (name && connection && !connection.companyName) {
            connectionStore.setCompanyName(connectionId, name);
            connection.companyName = name;
          }

          return {
            ...info,
            connection: connection ? summarize(connection) : { realmId },
          };
        },
        "get_company_info",
      ),
  );

  server.registerTool(
    "connection_status",
    {
      description:
        "Which QuickBooks company this connection is bound to, and how it was set up: realm id, environment, cached company name, who authorized it, when it was connected, when its credentials last refreshed, and whether write tools are enabled. " +
        "Makes no call to QuickBooks, so it still answers when Intuit is slow or erroring — use it as the identity check when get_company_info cannot be reached.",
    },
    async () => {
      const connection = connectionStore.get(connectionId);
      if (!connection) {
        return toolError(
          "No QuickBooks connection is bound to this token. Re-authorize to reconnect.",
        );
      }
      return json(summarize(connection));
    },
  );
}
