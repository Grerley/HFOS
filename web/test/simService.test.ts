// Regression tests for the simulation service marshalling (src/server/simulations.ts).
// Guards the "0/blank optimise field means keep the base value" rule, which a
// naive numeric default broke (collapsing the optimised loan to a 1-month term
// and reporting the entire interest bill as "saved").
import { describe, expect, it } from "vitest";
import { runSimulation } from "../src/server/simulations";

describe("asset optimise fallback", () => {
  const base = {
    purchase_price_cents: 100_000_000,
    deposit_cents: 10_000_000,
    annual_rate: 0.115,
    repayment_months: 240,
  };

  it("no optimise input → optimised equals base (nothing saved)", () => {
    const r = runSimulation("asset", { ...base, extra_monthly_cents: 0, optimised_deposit_cents: 0, optimised_months: 0 });
    const opt = (r.detail as any).optimised;
    expect(opt.interest_saved_cents).toBe(0);
    expect(opt.months_saved).toBe(0);
  });

  it("an actual extra payment does save interest and time", () => {
    const r = runSimulation("asset", { ...base, extra_monthly_cents: 200_000, optimised_deposit_cents: 0, optimised_months: 0 });
    const opt = (r.detail as any).optimised;
    expect(opt.interest_saved_cents).toBeGreaterThan(0);
    expect(opt.months_saved).toBeGreaterThan(0);
  });

  it("investment and tax types still dispatch", () => {
    expect(runSimulation("investment", { monthly_contribution_cents: 100000, months: 60 }).type).toBe("investment");
    expect(runSimulation("tax", { year: 2026, gross_annual_income_cents: 60_000_000 }).type).toBe("tax");
  });
});

describe("investment risk appetite drives the return", () => {
  const common = { current_balance_cents: 1_000_000, monthly_contribution_cents: 200_000, months: 240 };

  it("lower risk maps to a lower assumed return and a lower projected value", () => {
    const low = runSimulation("investment", { ...common, risk_profile: "low" });
    const high = runSimulation("investment", { ...common, risk_profile: "high" });
    expect((low.detail as any).annual_return).toBeLessThan((high.detail as any).annual_return);
    expect((low.detail as any).final_nominal_cents).toBeLessThan((high.detail as any).final_nominal_cents);
  });

  it("uses the central profile return when no explicit return is given", () => {
    const low = runSimulation("investment", { ...common, risk_profile: "low" });
    const med = runSimulation("investment", { ...common, risk_profile: "medium" });
    const high = runSimulation("investment", { ...common, risk_profile: "high" });
    expect((low.detail as any).annual_return).toBe(0.07);
    expect((med.detail as any).annual_return).toBe(0.10);
    expect((high.detail as any).annual_return).toBe(0.13);
  });

  it("an explicit return still overrides the profile", () => {
    const r = runSimulation("investment", { ...common, risk_profile: "low", annual_return: 0.20 });
    expect((r.detail as any).annual_return).toBe(0.20);
  });
});
