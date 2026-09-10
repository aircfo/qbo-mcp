import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../store/connection-store.js";
import {
  type ReconcileDeps,
  reconcileConnection,
} from "../connection-reconcile.js";

const REALM = "793988035";
const EMAIL = "kim@aircfo.com";

const FRESH = {
  realmId: REALM,
  email: EMAIL,
  emailVerified: true,
  termsAcceptedAt: 1_700_000_000_000,
  accessToken: "new-access",
  accessExpiresAt: 1_800_000_000_000,
  refreshToken: "new-refresh",
};

function existingConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "existing-id",
    realmId: REALM,
    companyName: "airCFO",
    email: EMAIL,
    emailVerified: true,
    writesEnabled: false,
    termsAcceptedAt: 1_600_000_000_000,
    accessToken: "old-access",
    accessExpiresAt: 1_600_000_000_000,
    refreshToken: "old-refresh",
    refreshUpdatedAt: 1_600_000_000_000,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  };
}

function deps(existing: Connection | null): ReconcileDeps & {
  create: ReturnType<typeof vi.fn>;
  updateTokens: ReturnType<typeof vi.fn>;
  setEmailVerified: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(() => "created-id");
  const updateTokens = vi.fn();
  const setEmailVerified = vi.fn();
  return {
    connections: {
      findByRealmAndEmail: vi.fn(() => existing),
      create,
      updateTokens,
      setEmailVerified,
    },
    revokeIntuitToken: vi.fn(async () => {}),
    onRevokeFailed: vi.fn(),
    create,
    updateTokens,
    setEmailVerified,
  };
}

describe("reconcileConnection", () => {
  it("creates a connection the first time a person connects a company", async () => {
    const d = deps(null);
    const result = await reconcileConnection(d, FRESH);

    expect(result).toEqual({ connectionId: "created-id", reused: false });
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        realmId: REALM,
        email: EMAIL,
        emailVerified: true,
      }),
    );
    expect(d.updateTokens).not.toHaveBeenCalled();
    expect(d.revokeIntuitToken).not.toHaveBeenCalled();
  });

  it("reuses the existing row on a repeat authorization, keeping its id", async () => {
    const d = deps(existingConnection());
    const result = await reconcileConnection(d, FRESH);

    // The id has to survive: other MCP clients on this company hold downstream
    // tokens that resolve to it, and a new id would break every one of them.
    expect(result).toEqual({ connectionId: "existing-id", reused: true });
    expect(d.create).not.toHaveBeenCalled();
    expect(d.updateTokens).toHaveBeenCalledWith("existing-id", {
      accessToken: "new-access",
      accessExpiresAt: FRESH.accessExpiresAt,
      refreshToken: "new-refresh",
    });
  });

  it("revokes the credential it is about to drop", async () => {
    const d = deps(existingConnection());
    await reconcileConnection(d, FRESH);
    expect(d.revokeIntuitToken).toHaveBeenCalledWith("old-refresh");
  });

  it("does not revoke when Intuit handed back the same refresh token", async () => {
    // Revoking a refresh token also kills its access tokens, so revoking a
    // value Intuit just reissued would destroy the connection being made.
    const d = deps(existingConnection({ refreshToken: FRESH.refreshToken }));
    await reconcileConnection(d, FRESH);

    expect(d.revokeIntuitToken).not.toHaveBeenCalled();
    expect(d.updateTokens).toHaveBeenCalledOnce();
  });

  it("stores the new credentials even when the revoke fails", async () => {
    const d = deps(existingConnection());
    const boom = new Error("Intuit revoke endpoint is down");
    d.revokeIntuitToken = vi.fn(async () => {
      throw boom;
    });

    const result = await reconcileConnection(d, FRESH);

    expect(d.onRevokeFailed).toHaveBeenCalledWith(boom, "existing-id");
    expect(d.updateTokens).toHaveBeenCalledOnce();
    expect(result.reused).toBe(true);
  });

  it("promotes a row whose address predates the identity gate", async () => {
    // Every connection made before the gate has an unverified, typed-in
    // address. When the same person proves that address through Google, the
    // row they already had is the one that should carry the verified identity.
    const d = deps(existingConnection({ emailVerified: false }));
    await reconcileConnection(d, FRESH);
    expect(d.setEmailVerified).toHaveBeenCalledWith("existing-id", true);
  });

  it("leaves an already-verified row alone", async () => {
    const d = deps(existingConnection({ emailVerified: true }));
    await reconcileConnection(d, FRESH);
    expect(d.setEmailVerified).not.toHaveBeenCalled();
  });

  it("creates without a lookup when no email was collected", async () => {
    const d = deps(existingConnection());
    const result = await reconcileConnection(d, { ...FRESH, email: null });

    expect(d.connections.findByRealmAndEmail).not.toHaveBeenCalled();
    expect(result.reused).toBe(false);
  });
});
