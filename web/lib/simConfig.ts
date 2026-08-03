// Declarative input schema for the three simulation planners. Shared by the
// planner page. Money fields are entered in major units and converted to cents
// before hitting the API; percent fields are entered as whole percents and
// converted to fractions. The server owns every calculation.
import { toCents } from "./format";

export type SimType = "investment" | "tax" | "asset";
export type FieldKind = "money" | "percent" | "int" | "months" | "select" | "text";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  def: string;                 // default display value
  options?: { value: string; label: string }[];
  adv?: boolean;               // hidden behind "advanced assumptions"
  help?: string;
  group?: "essential" | "optimise" | "advanced";
}

export const SIM_META: Record<SimType, { title: string; blurb: string; icon: string; question: string }> = {
  investment: {
    title: "Investment & Savings Planner",
    icon: "◎",
    blurb: "Project a goal's future value, find the contribution to reach it, and see nominal vs real outcomes.",
    question: "How should we save and invest to reach our goals?",
  },
  tax: {
    title: "Tax Planner",
    icon: "▤",
    blurb: "Project your annual SA tax, compare straight vs optimised, and see the tax saving with its cash cost.",
    question: "How can we structure income and contributions tax-efficiently?",
  },
  asset: {
    title: "Asset Acquisition Planner",
    icon: "⌂",
    blurb: "Test affordability, compare financing, and optimise repayment to cut interest and time.",
    question: "Can we afford this asset, and what financing is best?",
  },
};

const RISK_OPTS = [
  { value: "medium", label: "Medium — balanced" },
  { value: "low", label: "Low — capital preservation" },
  { value: "high", label: "High — growth" },
];

export const FIELDS: Record<SimType, FieldDef[]> = {
  investment: [
    { key: "current_balance_cents", label: "Current balance", kind: "money", def: "0", group: "essential" },
    { key: "monthly_contribution_cents", label: "Monthly contribution", kind: "money", def: "2000", group: "essential" },
    { key: "months", label: "Investment period (months)", kind: "months", def: "120", group: "essential" },
    { key: "risk_profile", label: "Risk appetite", kind: "select", def: "medium", options: RISK_OPTS, group: "essential", help: "Sets the expected return unless you override it below." },
    { key: "target_amount_cents", label: "Target amount (optional)", kind: "money", def: "0", group: "essential", help: "Set a target to see the contribution / time / return needed." },
    { key: "lump_sum_cents", label: "Initial lump sum", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "annual_return", label: "Expected annual return %", kind: "percent", def: "10", group: "advanced", adv: true, help: "Overrides the risk-profile return." },
    { key: "annual_fees", label: "Annual fees %", kind: "percent", def: "1", group: "advanced", adv: true },
    { key: "annual_inflation", label: "Inflation %", kind: "percent", def: "5", group: "advanced", adv: true },
    { key: "contribution_escalation", label: "Annual contribution increase %", kind: "percent", def: "0", group: "advanced", adv: true },
    { key: "contribution_timing", label: "Contribution timing", kind: "select", def: "end", options: [{ value: "end", label: "End of month" }, { value: "begin", label: "Start of month" }], group: "advanced", adv: true },
    { key: "tax_rate_on_growth", label: "Tax on growth % (taxable wrapper)", kind: "percent", def: "0", group: "advanced", adv: true },
    { key: "net_monthly_income_cents", label: "Net monthly income (affordability)", kind: "money", def: "0", group: "advanced", adv: true },
  ],
  tax: [
    { key: "year", label: "Tax year", kind: "select", def: "2026", options: [{ value: "2026", label: "2026 (Mar 2025–Feb 2026)" }, { value: "2025", label: "2025 (Mar 2024–Feb 2025)" }], group: "essential" },
    { key: "gross_annual_income_cents", label: "Gross annual income", kind: "money", def: "600000", group: "essential" },
    { key: "age", label: "Age", kind: "int", def: "35", group: "essential" },
    { key: "medical_members", label: "Medical scheme members (incl. you)", kind: "int", def: "0", group: "essential" },
    { key: "ra_contribution_cents", label: "Current retirement contribution (annual)", kind: "money", def: "0", group: "essential" },
    { key: "additional_ra_cents", label: "Extra retirement contribution to model", kind: "money", def: "0", group: "optimise", help: "Deductible up to 27.5% of income, capped at R350,000/yr." },
    { key: "additional_donation_cents", label: "Extra qualifying donation to model", kind: "money", def: "0", group: "optimise", help: "s18A donations deductible up to 10% of taxable income." },
    { key: "donations_cents", label: "Current qualifying donations (annual)", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "other_deductions_cents", label: "Other allowable deductions (annual)", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "paye_paid_cents", label: "PAYE paid to date", kind: "money", def: "0", group: "advanced", adv: true },
  ],
  asset: [
    { key: "asset_type", label: "Asset type", kind: "select", def: "house", options: [
      { value: "house", label: "Primary residence" }, { value: "investment_property", label: "Investment property" },
      { value: "vehicle", label: "Vehicle" }, { value: "solar", label: "Solar installation" },
      { value: "business", label: "Business asset" }, { value: "other", label: "Other" },
    ], group: "essential" },
    { key: "purchase_price_cents", label: "Purchase price", kind: "money", def: "1000000", group: "essential" },
    { key: "deposit_cents", label: "Deposit", kind: "money", def: "100000", group: "essential" },
    { key: "annual_rate", label: "Interest rate %", kind: "percent", def: "11.5", group: "essential" },
    { key: "repayment_months", label: "Repayment period (months)", kind: "months", def: "240", group: "essential" },
    { key: "net_monthly_income_cents", label: "Net monthly income", kind: "money", def: "0", group: "essential", help: "Used for the debt-service ratio and stress test." },
    { key: "extra_monthly_cents", label: "Extra monthly payment (optimise)", kind: "money", def: "0", group: "optimise" },
    { key: "optimised_deposit_cents", label: "Alternative deposit (optimise)", kind: "money", def: "0", group: "optimise", help: "Leave 0 to keep the deposit above." },
    { key: "optimised_months", label: "Alternative term months (optimise)", kind: "months", def: "0", group: "optimise", help: "Leave 0 to keep the term above." },
    { key: "transaction_costs_cents", label: "Transaction costs (transfer/legal)", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "balloon_cents", label: "Balloon / residual", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "monthly_fee_cents", label: "Monthly service fee", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "max_instalment_cents", label: "Max affordable instalment", kind: "money", def: "0", group: "advanced", adv: true },
    { key: "discount_rate", label: "NPV discount rate %", kind: "percent", def: "8", group: "advanced", adv: true },
  ],
};

/** Build the default display-value map for a type. */
export function defaultInputs(type: SimType): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS[type]) out[f.key] = f.def;
  return out;
}

/** Convert display values to the assumptions payload the API expects. */
export function toAssumptions(type: SimType, inputs: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[type]) {
    const raw = inputs[f.key] ?? f.def;
    switch (f.kind) {
      case "money": out[f.key] = toCents(raw); break;
      case "percent": out[f.key] = (parseFloat(raw) || 0) / 100; break;
      case "int": case "months": out[f.key] = Math.round(parseFloat(raw) || 0); break;
      default: out[f.key] = raw;
    }
  }
  // Optional overrides: only send annual_return when the user set it (so the
  // risk profile drives it otherwise) — for investment.
  if (type === "investment" && (!inputs.annual_return || inputs.annual_return === "")) delete out.annual_return;
  return out;
}

/** Rehydrate display values from a stored assumptions payload. */
export function fromAssumptions(type: SimType, a: Record<string, unknown>): Record<string, string> {
  const out = defaultInputs(type);
  for (const f of FIELDS[type]) {
    if (!(f.key in a)) continue;
    const v = a[f.key];
    if (v == null) continue;
    switch (f.kind) {
      case "money": out[f.key] = (Number(v) / 100).toString(); break;
      case "percent": out[f.key] = (Number(v) * 100).toString(); break;
      default: out[f.key] = String(v);
    }
  }
  return out;
}
