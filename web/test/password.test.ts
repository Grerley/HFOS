import { describe, expect, it } from "vitest";
import { validatePassword } from "../src/lib/password";

describe("validatePassword", () => {
  it("accepts a reasonable password", () => {
    expect(validatePassword("River-Sky-42", "sam@example.com")).toBeNull();
  });
  it("rejects too-short passwords", () => {
    expect(validatePassword("abc12", "sam@example.com")).toMatch(/at least/);
  });
  it("rejects common passwords", () => {
    expect(validatePassword("password123", "sam@example.com")).toMatch(/common/);
  });
  it("rejects passwords containing the email name", () => {
    expect(validatePassword("samuel-account", "samuel@example.com")).toMatch(/email/);
  });
  it("rejects a single repeated character", () => {
    expect(validatePassword("aaaaaaaa", "sam@example.com")).toMatch(/simple/);
  });
});
