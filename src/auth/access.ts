import { env } from "../config/env.js";

/** The sentinel that opens access to every verified address on the domain. */
export const ANY_DOMAIN_USER = "*";

export interface AccessPolicy {
  /** The Workspace domain an address must belong to. */
  domain: string;
  /** Named addresses, or the single `*` sentinel. Empty admits nobody. */
  allowed: string[];
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether an address may use this server, given a policy. Pure, so every shape
 * of policy is testable without rebuilding the environment.
 *
 * Three conditions, all required: the identity provider reported the address
 * verified, the address belongs to the policy's domain, and the policy admits
 * it — by naming it, or by being the `*` sentinel.
 *
 * An empty `allowed` admits nobody, deliberately. `*` has to be a visible
 * value, so that a variable accidentally cleared during a deploy locks people
 * out rather than exposing a whole domain.
 *
 * Passing here grants nothing on its own. Reaching a company's ledger also
 * requires having completed Intuit consent for that company, and each grant is
 * its own stored credential — which is why domain-wide access is acceptable
 * here, while the Drive connector, holding a key that can read any teammate's
 * mailbox, keeps an explicit list.
 */
export function isAddressAllowed(
  email: string,
  emailVerified: boolean,
  policy: AccessPolicy,
): boolean {
  if (!emailVerified) return false;
  if (policy.allowed.length === 0) return false;

  const normalized = normalize(email);
  if (!normalized.endsWith(`@${policy.domain.trim().toLowerCase()}`)) {
    return false;
  }
  if (policy.allowed.includes(ANY_DOMAIN_USER)) return true;
  return policy.allowed.includes(normalized);
}

/** Whether an address is an administrator, given the list. Pure. */
export function isAddressAdmin(
  email: string | null,
  admins: string[],
): boolean {
  if (!email) return false;
  return admins.includes(normalize(email));
}

/** The configured policy, from the environment. */
export function accessPolicy(): AccessPolicy {
  return { domain: env.ALLOWED_DOMAIN, allowed: env.ALLOWED_USERS };
}

export function isAllowedUser(email: string, emailVerified: boolean): boolean {
  return isAddressAllowed(email, emailVerified, accessPolicy());
}

export function isAdmin(email: string | null): boolean {
  return isAddressAdmin(email, env.ADMIN_USERS);
}
