import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/server/telegram";

describe("telegram command parsing", () => {
  it("parses a bare command", () => {
    expect(parseCommand("/help")).toEqual({ cmd: "help", arg: "" });
  });

  it("parses a command with an argument", () => {
    expect(parseCommand("/link ABCD2345")).toEqual({ cmd: "link", arg: "ABCD2345" });
  });

  it("handles the /start deep-link payload", () => {
    expect(parseCommand("/start ABCD2345")).toEqual({ cmd: "start", arg: "ABCD2345" });
  });

  it("strips a @botname suffix (group chats) and lowercases the command", () => {
    expect(parseCommand("/Link@HfosBot XYZ")).toEqual({ cmd: "link", arg: "XYZ" });
  });

  it("treats non-command text as a question", () => {
    expect(parseCommand("are we over budget this month?")).toEqual({ cmd: null, arg: "are we over budget this month?" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCommand("  /unlink  ")).toEqual({ cmd: "unlink", arg: "" });
  });
});
