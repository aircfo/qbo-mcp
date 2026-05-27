import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated symmetric encryption for credentials at rest (AES-256-GCM).
 *
 * We must store Intuit tokens *reversibly* — unlike a password we only compare,
 * these get replayed to Intuit on every call, so hashing won't do. GCM gives us
 * confidentiality plus tamper detection: a modified ciphertext fails the auth
 * tag check on decrypt instead of silently returning garbage.
 *
 * Wire format: `base64(iv):base64(authTag):base64(ciphertext)`. The 96-bit IV
 * is randomised per encryption, so encrypting the same token twice yields
 * different ciphertext.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) {
      throw new Error("TokenCipher requires a 32-byte key (base64-encoded)");
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
  }

  decrypt(packed: string): string {
    const parts = packed.split(":");
    if (parts.length !== 3) {
      throw new Error("TokenCipher.decrypt: malformed ciphertext");
    }
    const [iv, authTag, ciphertext] = parts.map((p) =>
      Buffer.from(p, "base64"),
    );
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv!);
    decipher.setAuthTag(authTag!);
    return Buffer.concat([
      decipher.update(ciphertext!),
      decipher.final(),
    ]).toString("utf8");
  }
}
