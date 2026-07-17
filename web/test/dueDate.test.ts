// Pins deriveDueDate: recurring day-of-month → concrete ISO due date per period.
import { describe, expect, it } from "vitest";
import { deriveDueDate } from "../src/server/services";

const jan = { start_date: "2026-01-01", end_date: "2026-01-31" };
const feb = { start_date: "2026-02-01", end_date: "2026-02-28" };
const cycle = { start_date: "2026-01-25", end_date: "2026-02-24" }; // 25th→24th cycle

describe("deriveDueDate", () => {
  it("maps a day within an aligned month", () => {
    expect(deriveDueDate(jan, 25)).toBe("2026-01-25");
  });

  it("clamps to the month length", () => {
    expect(deriveDueDate(feb, 31)).toBe("2026-02-28");
  });

  it("lands in the correct month for a cross-month cycle", () => {
    // day 5 falls in the second month of a 25th→24th cycle
    expect(deriveDueDate(cycle, 5)).toBe("2026-02-05");
    // day 28 falls in the first month
    expect(deriveDueDate(cycle, 28)).toBe("2026-01-28");
  });

  it("returns null for missing or out-of-range days", () => {
    expect(deriveDueDate(jan, null)).toBeNull();
    expect(deriveDueDate(jan, 0)).toBeNull();
    expect(deriveDueDate(jan, 32)).toBeNull();
    expect(deriveDueDate(jan, undefined)).toBeNull();
  });
});
