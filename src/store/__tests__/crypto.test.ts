import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenCipher } from "../crypto.js";

const testKey = randomBytes(32).toString("base64");

describe("TokenCipher", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const cipher = new TokenCipher(testKey);
    const secret = "qbo-refresh-token-abc123";
    expect(cipher.decrypt(cipher.encrypt(secret))).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const cipher = new TokenCipher(testKey);
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => new TokenCipher(randomBytes(16).toString("base64"))).toThrow();
  });

  it("throws on tampered ciphertext instead of returning garbage", () => {
    const cipher = new TokenCipher(testKey);
    const packed = cipher.encrypt("secret");
    const [iv, tag, ct] = packed.split(":");
    const flipped = Buffer.from(ct!, "base64");
    flipped[0] ^= 0x01;
    const tampered = [iv, tag, flipped.toString("base64")].join(":");
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("cannot decrypt ciphertext produced with a different key", () => {
    const a = new TokenCipher(testKey);
    const b = new TokenCipher(randomBytes(32).toString("base64"));
    expect(() => b.decrypt(a.encrypt("secret"))).toThrow();
  });
});
