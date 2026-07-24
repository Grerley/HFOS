import { describe, expect, it } from "vitest";
import { COPILOT_TOOLS, RECORD_INSIGHT_TOOL } from "../src/server/copilotTools";

describe("copilot tool schemas", () => {
  it("exposes a non-empty set of read-only analysis tools", () => {
    expect(COPILOT_TOOLS.length).toBeGreaterThanOrEqual(8);
  });

  it("every tool has a unique name, a description and an object input_schema", () => {
    const names = new Set<string>();
    for (const t of COPILOT_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(names.has(t.name)).toBe(false);
      names.add(t.name);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("covers the core analytical surface", () => {
    const names = COPILOT_TOOLS.map((t) => t.name);
    for (const required of ["list_periods", "period_financials", "compare_periods", "financial_trends", "net_worth", "goals"]) {
      expect(names).toContain(required);
    }
  });

  it("exposes owner-level tools so the agent can answer 'whose line is this'", () => {
    const names = COPILOT_TOOLS.map((t) => t.name);
    for (const required of ["budget_lines", "owner_breakdown", "household_members"]) {
      expect(names).toContain(required);
    }
    const bl = COPILOT_TOOLS.find((t) => t.name === "budget_lines")!;
    expect(bl.input_schema.properties).toHaveProperty("owner_name");
  });

  it("record_insight requires the fields the analyst persists", () => {
    expect(RECORD_INSIGHT_TOOL.name).toBe("record_insight");
    expect(RECORD_INSIGHT_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["type", "severity", "summary", "explanation"]),
    );
  });
});
