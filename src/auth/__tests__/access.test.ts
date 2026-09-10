import { describe, expect, it } from "vitest";
import {
  type AccessPolicy,
  isAddressAdmin,
  isAddressAllowed,
} from "../access.js";

const DOMAIN = "aircfo.com";
const anyUser: AccessPolicy = { domain: DOMAIN, allowed: ["*"] };
const named: AccessPolicy = {
  domain: DOMAIN,
  allowed: ["kim@aircfo.com", "kevin@aircfo.com"],
};
const empty: AccessPolicy = { domain: DOMAIN, allowed: [] };

describe("isAddressAllowed", () => {
  it("admits any verified address on the domain under the sentinel", () => {
    expect(isAddressAllowed("kim@aircfo.com", true, anyUser)).toBe(true);
    expect(isAddressAllowed("brand.new.hire@aircfo.com", true, anyUser)).toBe(
      true,
    );
  });

  it("admits only the named addresses under an explicit list", () => {
    expect(isAddressAllowed("kim@aircfo.com", true, named)).toBe(true);
    expect(isAddressAllowed("someone.else@aircfo.com", true, named)).toBe(
      false,
    );
  });

  it("admits nobody when the list is empty", () => {
    // The fail-closed case: a variable accidentally cleared during a deploy
    // must lock people out, not open the server to a whole domain.
    expect(isAddressAllowed("kim@aircfo.com", true, empty)).toBe(false);
    expect(isAddressAllowed("alex@aircfo.com", true, empty)).toBe(false);
  });

  it("refuses an address the provider did not report as verified", () => {
    expect(isAddressAllowed("kim@aircfo.com", false, anyUser)).toBe(false);
    expect(isAddressAllowed("kim@aircfo.com", false, named)).toBe(false);
  });

  it("refuses an address outside the domain, sentinel or not", () => {
    expect(isAddressAllowed("aarondras@gmail.com", true, anyUser)).toBe(false);
    expect(isAddressAllowed("kim@notaircfo.com", true, anyUser)).toBe(false);
  });

  it("refuses a lookalike domain that merely ends the same way", () => {
    // "evil-aircfo.com" ends with "aircfo.com" as a string, so the check has
    // to be anchored on the @.
    expect(isAddressAllowed("kim@evil-aircfo.com", true, anyUser)).toBe(false);
    expect(isAddressAllowed("kim@sub.aircfo.com", true, anyUser)).toBe(false);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isAddressAllowed("  KIM@AirCFO.com ", true, named)).toBe(true);
    expect(
      isAddressAllowed("KEVIN@AIRCFO.COM", true, {
        domain: "AirCFO.com",
        allowed: ["kevin@aircfo.com"],
      }),
    ).toBe(true);
  });
});

describe("isAddressAdmin", () => {
  const admins = ["alex@aircfo.com", "david@aircfo.com"];

  it("recognises an administrator, case-insensitively", () => {
    expect(isAddressAdmin("alex@aircfo.com", admins)).toBe(true);
    expect(isAddressAdmin("Alex@aircfo.com", admins)).toBe(true);
  });

  it("does not promote an ordinary user or a missing address", () => {
    expect(isAddressAdmin("kim@aircfo.com", admins)).toBe(false);
    expect(isAddressAdmin(null, admins)).toBe(false);
    expect(isAddressAdmin("alex@aircfo.com", [])).toBe(false);
  });
});
