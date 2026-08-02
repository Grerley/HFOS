// Budget year assignment for Excel uploads: parseMonthDates(label, defaultYear).
import { describe, expect, it } from "vitest";
import { parseMonthDates } from "../src/server/import";

describe("parseMonthDates budget year", () => {
  it("uses the assigned year when the sheet label has none", () => {
    expect(parseMonthDates("Jan4Feb", 2026)).toEqual(["2026-01-01", "2026-02-28"]);
  });

  it("keeps an explicit year in the label over the assigned one", () => {
    expect(parseMonthDates("Jan4Feb 2024", 2026)?.[0]).toBe("2024-01-01");
  });

  it("still defaults to 2025 when no year is provided at all", () => {
    expect(parseMonthDates("Jan4Feb")?.[0]).toBe("2025-01-01");
  });

  it("returns null for a label that isn't a month range", () => {
    expect(parseMonthDates("Summary", 2026)).toBeNull();
  });
});
