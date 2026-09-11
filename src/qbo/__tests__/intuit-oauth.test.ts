import { describe, expect, it, vi } from "vitest";
import { IntuitOAuth, type IntuitOAuthClient } from "../intuit-oauth.js";

function fakeClient(
  overrides: Partial<IntuitOAuthClient> = {},
): IntuitOAuthClient & { revoke: ReturnType<typeof vi.fn> } {
  const revoke = vi.fn(async () => ({}));
  return {
    authorizeUri: vi.fn(() => "https://appcenter.intuit.com/connect/oauth2"),
    createToken: vi.fn(async () => ({
      token: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        realmId: "793988035",
      },
    })),
    refreshUsingToken: vi.fn(async () => ({
      token: { access_token: "access-2", expires_in: 3600 },
    })),
    revoke,
    ...overrides,
  };
}

describe("IntuitOAuth.revoke", () => {
  it("names the token as `refresh_token`, the only key the client reads", async () => {
    // The bug this pins down: `OAuthClient.revoke` reads
    // `params.access_token || params.refresh_token || <its own current token>`.
    // We passed `{ token }`, which it ignores, so the fallback revoked the
    // client's own token — and on this server that client is a singleton whose
    // state was last set by `createToken`. The result was that a fresh
    // authorization revoked the access token it had just minted, and the
    // connection came back dead with Intuit answering 401 AuthenticationFailed.
    const client = fakeClient();
    await new IntuitOAuth(client).revoke("refresh-to-kill");

    expect(client.revoke).toHaveBeenCalledWith({
      refresh_token: "refresh-to-kill",
    });

    const params = client.revoke.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("token");
    expect(params).not.toHaveProperty("access_token");
  });

  it("surfaces a revoke failure rather than swallowing it", async () => {
    const client = fakeClient({
      revoke: vi.fn(async () => {
        throw new Error("Intuit revoke endpoint is down");
      }),
    });
    await expect(new IntuitOAuth(client).revoke("r")).rejects.toThrow(
      "Intuit revoke endpoint is down",
    );
  });
});

describe("IntuitOAuth token normalisation", () => {
  it("turns an expiry in seconds into an absolute deadline", async () => {
    const before = Date.now();
    const tokens = await new IntuitOAuth(fakeClient()).exchangeCode(
      "https://qbo-mcp.test/oauth/intuit/callback?code=x&realmId=793988035",
    );

    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.realmId).toBe("793988035");
    expect(tokens.accessExpiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it("keeps the refresh token it was given when Intuit returns none", async () => {
    // Intuit rotates the refresh token only periodically; a refresh that
    // returns no new one means the old one is still current, and dropping it
    // would strand the connection.
    const tokens = await new IntuitOAuth(fakeClient()).refresh("refresh-kept");
    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("refresh-kept");
  });
});
