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
  findByRealmAndEmail: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(() => "created-id");
  const updateTokens = vi.fn();
  const setEmailVerified = vi.fn();
  const findByRealmAndEmail = vi.fn(() => existing);
  return {
    connections: { findByRealmAndEmail, create, updateTokens, setEmailVerified },
    create,
    updateTokens,
    setEmailVerified,
    findByRealmAndEmail,
  };
}

describe("reconcileConnection", () => {
  it("creates a connection the first time a person connects a company", () => {
    const d = deps(null);
    const result = reconcileConnection(d, FRESH);

    expect(result).toEqual({ connectionId: "created-id", reused: false });
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        realmId: REALM,
        email: EMAIL,
        emailVerified: true,
      }),
    );
    expect(d.updateTokens).not.toHaveBeenCalled();
  });

  it("reuses the existing row on a repeat authorization, keeping its id", () => {
    const d = deps(existingConnection());
    const result = reconcileConnection(d, FRESH);

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




  it("promotes a row whose address predates the identity gate", async () => {
    // Every connection made before the gate has an unverified, typed-in
    // address. When the same person proves that address through Google, the
    // row they already had is the one that should carry the verified identity.
    const d = deps(existingConnection({ emailVerified: false }));
    reconcileConnection(d, FRESH);
    expect(d.setEmailVerified).toHaveBeenCalledWith("existing-id", true);
  });

  it("leaves an already-verified row alone", () => {
    const d = deps(existingConnection({ emailVerified: true }));
    reconcileConnection(d, FRESH);
    expect(d.setEmailVerified).not.toHaveBeenCalled();
  });

  it("revokes nothing, so the credentials it just stored stay usable", () => {
    // The bug this replaces: reconcile revoked the superseded refresh token,
    // and Intuit's revoke ends the whole authorization — so a connection came
    // back from a successful re-authorization already dead, answering 401
    // AuthenticationFailed. There is no revoke hook here any more; this test
    // asserts the shape of the dependency, so re-adding one is a visible change.
    const d = deps(existingConnection());
    reconcileConnection(d, FRESH);
    expect(Object.keys(d.connections).sort()).toEqual([
      "create",
      "findByRealmAndEmail",
      "setEmailVerified",
      "updateTokens",
    ]);
  });

  it("creates without a lookup when no email was collected", () => {
    const d = deps(existingConnection());
    const result = reconcileConnection(d, { ...FRESH, email: null });

    expect(d.findByRealmAndEmail).not.toHaveBeenCalled();
    expect(result.reused).toBe(false);
  });
});
