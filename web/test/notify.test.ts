import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/server/notify";

describe("normalizePhone", () => {
  it("strips formatting and keeps valid E.164-ish numbers", () => {
    expect(normalizePhone("+27 82 000 0000")).toBe("+27820000000");
    expect(normalizePhone("(082) 000-0000")).toBe("0820000000");
  });
  it("rejects obviously invalid input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+12")).toBeNull(); // too short
  });
});
