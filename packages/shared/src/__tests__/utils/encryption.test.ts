import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { encrypt, decrypt } from "../../utils/encryption";

describe("Encryption utilities", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  const testKey = "test-encryption-key-32-chars-long";

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it("should encrypt and decrypt text correctly", () => {
    const plaintext = "Hello, this is a secret message!";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":");
  });

  it("should produce different ciphertext for same plaintext", () => {
    const plaintext = "Same message";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it("should handle empty strings", () => {
    const plaintext = "";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should handle unicode characters", () => {
    const plaintext = "Hello 🌍 Unicode! 中文 العربية";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should throw error when ENCRYPTION_KEY is missing", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY environment variable is required");
    expect(() => decrypt("test:test:test")).toThrow("ENCRYPTION_KEY environment variable is required");
  });

  it("should throw error for invalid encrypted format", () => {
    expect(() => decrypt("invalid-format")).toThrow("Invalid encrypted format");
    expect(() => decrypt("only:one:colon")).toThrow("Invalid encrypted format");
    expect(() => decrypt("")).toThrow("Invalid encrypted format");
  });

  it("should throw error for corrupted encrypted data", () => {
    const plaintext = "test message";
    const encrypted = encrypt(plaintext);
    const corruptedEncrypted = encrypted.replace(/[a-f0-9]/, "x");

    expect(() => decrypt(corruptedEncrypted)).toThrow();
  });

  it("should handle long text", () => {
    const plaintext = "A".repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
    expect(decrypted).toHaveLength(10000);
  });

  it("should produce encrypted text with expected format", () => {
    const plaintext = "test";
    const encrypted = encrypt(plaintext);
    const parts = encrypted.split(":");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24); // IV: 12 bytes = 24 hex chars
    expect(parts[1]).toHaveLength(32); // Tag: 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(8);  // "test" encrypted: 4 bytes = 8 hex chars
  });
});