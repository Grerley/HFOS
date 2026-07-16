import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, contentHash } from "../src/lib/hash";
import { createAccessToken, verifyAccessToken } from "../src/lib/auth";

describe("password hashing (PBKDF2, Workers-native)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("password123");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("password123", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces distinct hashes per salt", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("content hash is stable", async () => {
    expect(await contentHash("x")).toBe(await contentHash("x"));
  });
});

describe("JWT access tokens", () => {
  it("round-trips the subject and rejects a bad secret", async () => {
    const token = await createAccessToken("42", "secret-a");
    expect(await verifyAccessToken(token, "secret-a")).toBe("42");
    expect(await verifyAccessToken(token, "secret-b")).toBe(null);
    expect(await verifyAccessToken("garbage", "secret-a")).toBe(null);
  });
});
