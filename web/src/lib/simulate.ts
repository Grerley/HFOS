/**
 * HFOS simulation engine: deterministic maths for the Simulations module
 * (Investment & Savings, Tax, Asset Acquisition planning).
 *
 * Same rules as calc.ts: money is integer minor units (cents); rates are
 * fractional numbers (0.10 = 10%). Every formula is defined once here; the API
 * and UI never re-implement any of it. Pure and unit-tested.
 *
 * Scenario isolation (BR-008): nothing here reads or writes household budget
 * state — these are stateless calculators driven entirely by their inputs.
 */
import { monthlyRate, monthlyBondRepayment } from "./calc";

export const SIMULATE_VERSION = "1.0.0";

/** Round a ratio to 6 dp (matches calc.ts). */
function round6(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}
const clampMonths = (m: number) => Math.max(1, Math.min(Math.round(m || 12), 1200));

/**
 * Real return from nominal + inflation (BR-003): (1+nominal)/(1+inflation) − 1.
 */
export function realReturn(nominal: number, inflation: number): number {
  return round6((1 + nominal) / (1 + inflation) - 1);
}

/** Deflate a future nominal amount to today's money over `years` at `inflation`. */
export function realValue(nominalCents: number, inflation: number, years: number): number {
  if (inflation <= -1) return nominalCents;
  return Math.round(nominalCents / Math.pow(1 + inflation, years));
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk appetite → assumptions (§3.4). Administered centrally; ZAR nominal
// defaults. Callers may override any field. Horizons are in months.
// ─────────────────────────────────────────────────────────────────────────────
export type RiskProfile = "low" | "medium" | "high";

export interface RiskAssumptions {
  expected_return: number; // annual nominal, fractional
  volatility: number;      // annual standard deviation, fractional
  min_horizon_months: number;
  label: string;
  description: string;
}

export const RISK_PROFILES: Record<RiskProfile, RiskAssumptions> = {
  low: {
    expected_return: 0.07, volatility: 0.04, min_horizon_months: 12,
    label: "Low risk",
    description: "Capital preservation: cash and fixed income. Lower return, low volatility.",
  },
  medium: {
    expected_return: 0.10, volatility: 0.10, min_horizon_months: 36,
    label: "Medium risk",
    description: "Balanced multi-asset. Moderate return and volatility, medium-to-long horizon.",
  },
  high: {
    expected_return: 0.13, volatility: 0.18, min_horizon_months: 60,
    label: "High risk",
    description: "Growth assets / equity. Higher expected return, higher volatility, long horizon.",
  },
};

export function riskAssumptions(profile: RiskProfile): RiskAssumptions {
  return RISK_PROFILES[profile] ?? RISK_PROFILES.medium;
}

/**
 * Warn when the chosen risk profile is inconsistent with the goal horizon
 * (e.g. a high-risk portfolio for an emergency fund needed within 3 years).
 */
export function riskHorizonWarning(profile: RiskProfile, months: number): string | null {
  const a = riskAssumptions(profile);
  if (months < a.min_horizon_months) {
    return `A ${a.label.toLowerCase()} portfolio is usually inappropriate for a ${Math.round(
      months / 12 * 10,
    ) / 10}-year horizon. Short-horizon money is exposed to ${Math.round(
      a.volatility * 100,
    )}% annual volatility and a real chance of short-term loss. Consider a lower-risk profile.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Investment & Savings — deterministic future value (§3.5)
// ─────────────────────────────────────────────────────────────────────────────
export interface InvestmentInput {
  current_balance_cents: number;
  lump_sum_cents: number;
  monthly_contribution_cents: number;
  contribution_escalation: number; // annual, fractional (applied every 12 months)
  annual_return: number;           // gross nominal, fractional
  annual_fees: number;             // fractional; net return = return − fees
  annual_inflation: number;
  months: number;
  contribution_timing: "begin" | "end";
  tax_rate_on_growth: number;      // effective tax drag on growth (taxable wrapper); 0 = tax-free/retirement
}

export interface InvestmentPoint {
  month: number;
  balance_cents: number;
  contributions_to_date_cents: number;
  growth_to_date_cents: number;
}

export interface InvestmentResult {
  final_nominal_cents: number;
  final_real_cents: number;
  principal_cents: number;        // current balance + lump sum
  contributions_cents: number;    // recurring contributions made
  gross_return_cents: number;     // investment growth before fees/tax
  fees_cents: number;
  tax_cents: number;
  net_return_cents: number;       // gross − fees − tax
  months: number;
  series: InvestmentPoint[];
  formula: string;
}

const DEFAULT_INV: InvestmentInput = {
  current_balance_cents: 0, lump_sum_cents: 0, monthly_contribution_cents: 0,
  contribution_escalation: 0, annual_return: 0.10, annual_fees: 0.01,
  annual_inflation: 0.05, months: 120, contribution_timing: "end", tax_rate_on_growth: 0,
};

/**
 * Month-by-month future value of a starting balance + lump sum + (escalating)
 * recurring contributions, net of fees and tax. Discloses each component
 * separately (§3.5). Gross return uses the full return rate; fees are the drag
 * to the net rate; tax is applied to net growth for a taxable wrapper.
 */
export function investmentFutureValue(input: Partial<InvestmentInput>): InvestmentResult {
  const i = { ...DEFAULT_INV, ...input };
  const H = clampMonths(i.months);
  const mGross = monthlyRate(i.annual_return);
  const mNet = monthlyRate(i.annual_return - i.annual_fees);
  const taxMonthly = i.tax_rate_on_growth; // applied to each month's net growth

  const principal = i.current_balance_cents + i.lump_sum_cents;
  let balance = principal;
  let contributions = 0;
  let grossTotal = 0;
  let feeTotal = 0;
  let taxTotal = 0;

  const series: InvestmentPoint[] = [];
  for (let m = 1; m <= H; m++) {
    const yearIndex = Math.floor((m - 1) / 12);
    const contrib = Math.round(i.monthly_contribution_cents * Math.pow(1 + i.contribution_escalation, yearIndex));

    if (i.contribution_timing === "begin") { balance += contrib; contributions += contrib; }

    const gross = Math.round(balance * mGross);
    const net = Math.round(balance * mNet);
    const fee = gross - net;
    balance += net;
    grossTotal += gross;
    feeTotal += fee;

    if (taxMonthly > 0 && net > 0) {
      const tax = Math.round(net * taxMonthly);
      balance -= tax;
      taxTotal += tax;
    }

    if (i.contribution_timing === "end") { balance += contrib; contributions += contrib; }

    series.push({
      month: m,
      balance_cents: balance,
      contributions_to_date_cents: contributions,
      growth_to_date_cents: grossTotal - feeTotal - taxTotal,
    });
  }

  const years = H / 12;
  return {
    final_nominal_cents: balance,
    final_real_cents: realValue(balance, i.annual_inflation, years),
    principal_cents: principal,
    contributions_cents: contributions,
    gross_return_cents: grossTotal,
    fees_cents: feeTotal,
    tax_cents: taxTotal,
    net_return_cents: grossTotal - feeTotal - taxTotal,
    months: H,
    series,
    formula: "FV = PV·(1+r)ⁿ + Σ PMTₖ·(1+r)^(n−k); r = monthly net return, fees and tax disclosed separately",
  };
}

/** Just the final nominal value (used by goal-seek loops). */
function finalValue(input: Partial<InvestmentInput>): number {
  return investmentFutureValue(input).final_nominal_cents;
}

// ── Goal-seeking (§3.6) ───────────────────────────────────────────────────────
export interface GoalSeekResult {
  value: number | null;      // the solved quantity (cents / months / fraction), null if unsolvable
  feasible: boolean;         // false when the answer is implausible/unaffordable/never
  note: string;
}

/** Monotone-increasing bisection: find x in [lo,hi] where f(x) ≈ target. */
function bisect(f: (x: number) => number, target: number, lo: number, hi: number, iters = 60): number {
  let a = lo, b = hi;
  for (let k = 0; k < iters; k++) {
    const mid = (a + b) / 2;
    if (f(mid) < target) a = mid; else b = mid;
  }
  return (a + b) / 2;
}

/** How much must be contributed each month to reach `target`? (AC-002) */
export function requiredMonthlyContribution(target: number, input: Partial<InvestmentInput>): GoalSeekResult {
  const base = { ...DEFAULT_INV, ...input, monthly_contribution_cents: 0 };
  if (finalValue(base) >= target) {
    return { value: 0, feasible: true, note: "Already on track with the current balance and lump sum." };
  }
  const hi = Math.max(target, 100_00); // contributing the whole target each month always overshoots
  const solved = bisect((x) => finalValue({ ...base, monthly_contribution_cents: x }), target, 0, hi);
  return { value: Math.ceil(solved), feasible: true, note: "Level monthly contribution to reach the target by the horizon." };
}

/** How long (months) to reach `target` at the current contribution? */
export function monthsToTarget(target: number, input: Partial<InvestmentInput>): GoalSeekResult {
  const i = { ...DEFAULT_INV, ...input };
  let balance = i.current_balance_cents + i.lump_sum_cents;
  const mNet = monthlyRate(i.annual_return - i.annual_fees);
  if (balance >= target) return { value: 0, feasible: true, note: "Already funded." };
  for (let m = 1; m <= 1200; m++) {
    const yearIndex = Math.floor((m - 1) / 12);
    const contrib = Math.round(i.monthly_contribution_cents * Math.pow(1 + i.contribution_escalation, yearIndex));
    balance += Math.round(balance * mNet) + contrib;
    if (balance >= target) return { value: m, feasible: true, note: "Months of contributions to reach the target." };
  }
  return { value: null, feasible: false, note: "Not reachable within 100 years at this contribution — increase it or the return." };
}

/** What annual return would reach `target` at the current inputs? */
export function requiredAnnualReturn(target: number, input: Partial<InvestmentInput>): GoalSeekResult {
  const base = { ...DEFAULT_INV, ...input };
  const solved = bisect((x) => finalValue({ ...base, annual_return: x, annual_fees: 0 }), target, -0.5, 2.0);
  const feasible = solved <= 0.30;
  return {
    value: round6(solved),
    feasible,
    note: feasible
      ? "Gross annual return required (before fees) to reach the target."
      : `Requires an implausible ${Math.round(solved * 100)}% return. Increase contributions or extend the horizon instead.`,
  };
}

/** What once-off lump sum today would reach `target`? */
export function requiredLumpSum(target: number, input: Partial<InvestmentInput>): GoalSeekResult {
  const base = { ...DEFAULT_INV, ...input, lump_sum_cents: 0 };
  if (finalValue(base) >= target) return { value: 0, feasible: true, note: "No extra lump sum needed." };
  const solved = bisect((x) => finalValue({ ...base, lump_sum_cents: x }), target, 0, target);
  return { value: Math.ceil(solved), feasible: true, note: "Additional once-off lump sum required today." };
}

// ── Contribution affordability (§3.7) ─────────────────────────────────────────
export type AffordabilityStatus = "comfortable" | "manageable" | "stretched" | "unsustainable";

export interface AffordabilityThresholds {
  comfortable: number; // contribution ÷ net income ≤ this → comfortable
  manageable: number;
  stretched: number;   // above this → unsustainable
}
export const DEFAULT_AFFORDABILITY: AffordabilityThresholds = { comfortable: 0.15, manageable: 0.25, stretched: 0.35 };

export function affordabilityStatus(
  contributionCents: number,
  netIncomeCents: number,
  t: AffordabilityThresholds = DEFAULT_AFFORDABILITY,
): { ratio: number; status: AffordabilityStatus; remaining_cents: number } {
  const ratio = netIncomeCents > 0 ? round6(contributionCents / netIncomeCents) : 1;
  const status: AffordabilityStatus =
    ratio <= t.comfortable ? "comfortable" :
    ratio <= t.manageable ? "manageable" :
    ratio <= t.stretched ? "stretched" : "unsustainable";
  return { ratio, status, remaining_cents: netIncomeCents - contributionCents };
}

// ── Emergency fund (§3.9) ─────────────────────────────────────────────────────
export interface EmergencyFundInput {
  essential_monthly_cents: number;
  months_cover: number;
  current_cents: number;
  monthly_contribution_cents: number;
}
export interface EmergencyFundResult {
  required_cents: number;
  current_cents: number;
  gap_cents: number;
  months_of_cover_now: number;
  months_to_close: number | null;
  monthly_required_for_cover: number; // to reach target within `months_cover` months
}
export function emergencyFund(i: EmergencyFundInput): EmergencyFundResult {
  const required = Math.max(0, i.essential_monthly_cents) * Math.max(0, i.months_cover);
  const gap = Math.max(required - i.current_cents, 0);
  const monthsToClose = i.monthly_contribution_cents > 0 ? Math.ceil(gap / i.monthly_contribution_cents) : gap > 0 ? null : 0;
  const coverNow = i.essential_monthly_cents > 0 ? round6(i.current_cents / i.essential_monthly_cents) : 0;
  const monthlyForCover = i.months_cover > 0 ? Math.ceil(gap / i.months_cover) : gap;
  return {
    required_cents: required, current_cents: i.current_cents, gap_cents: gap,
    months_of_cover_now: coverNow, months_to_close: monthsToClose, monthly_required_for_cover: monthlyForCover,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax planning — South African individual income tax (§4). Tables versioned by
// tax year (BR-004). Amounts in cents. Monthly medical credits ×12 for annual.
// ─────────────────────────────────────────────────────────────────────────────
export interface TaxBracket { lower_cents: number; rate: number; base_cents: number }
export interface TaxTable {
  year: number;               // year of assessment ending 28/29 Feb of this year
  version: string;
  jurisdiction: "ZA";
  brackets: TaxBracket[];
  rebate_primary_cents: number;
  rebate_secondary_cents: number; // additional, 65–74
  rebate_tertiary_cents: number;  // additional, 75+
  threshold_below65_cents: number;
  threshold_65_74_cents: number;
  threshold_75_cents: number;
  medical_main_cents: number;       // per month
  medical_first_cents: number;      // per month
  medical_additional_cents: number; // per month, each further dependant
  ra_deduction_pct: number;         // 27.5%
  ra_deduction_cap_cents: number;   // R350,000
  donation_pct_cap: number;         // 10% of taxable income
  uif_rate: number;                 // employee 1%
  uif_monthly_ceiling_cents: number; // remuneration ceiling for UIF
  sdl_rate: number;                 // employer 1%
  tfsa_annual_cap_cents: number;
  tfsa_lifetime_cap_cents: number;
}

// 2025 & 2026 years of assessment share brackets/rebates (Budget 2025 left them
// unadjusted). Encoded once and reused so both years are selectable (§4.2).
const ZA_BRACKETS_2025: TaxBracket[] = [
  { lower_cents: 0, rate: 0.18, base_cents: 0 },
  { lower_cents: 23_710_000, rate: 0.26, base_cents: 4_267_800 },
  { lower_cents: 37_050_000, rate: 0.31, base_cents: 7_736_200 },
  { lower_cents: 51_280_000, rate: 0.36, base_cents: 12_147_500 },
  { lower_cents: 67_300_000, rate: 0.39, base_cents: 17_914_700 },
  { lower_cents: 85_790_000, rate: 0.41, base_cents: 25_125_800 },
  { lower_cents: 181_700_000, rate: 0.45, base_cents: 64_448_900 },
];

function zaTable(year: number, version: string): TaxTable {
  return {
    year, version, jurisdiction: "ZA",
    brackets: ZA_BRACKETS_2025,
    rebate_primary_cents: 1_723_500,
    rebate_secondary_cents: 944_400,
    rebate_tertiary_cents: 314_500,
    threshold_below65_cents: 9_575_000,
    threshold_65_74_cents: 14_821_700,
    threshold_75_cents: 16_568_900,
    medical_main_cents: 36_400,
    medical_first_cents: 36_400,
    medical_additional_cents: 24_600,
    ra_deduction_pct: 0.275,
    ra_deduction_cap_cents: 35_000_000,
    donation_pct_cap: 0.10,
    uif_rate: 0.01,
    uif_monthly_ceiling_cents: 1_771_200,
    sdl_rate: 0.01,
    tfsa_annual_cap_cents: 3_600_000,
    tfsa_lifetime_cap_cents: 50_000_000,
  };
}

export const TAX_TABLES: Record<string, TaxTable> = {
  "2025": zaTable(2025, "ZA-2025.1"),
  "2026": zaTable(2026, "ZA-2026.1"),
};

/** Resolve the tax table for a year (BR-004) or throw if unsupported. */
export function taxTable(year: number | string): TaxTable {
  const t = TAX_TABLES[String(year)];
  if (!t) throw new Error(`No tax table configured for year ${year}`);
  return t;
}

/** Annual tax before rebates for a taxable income (progressive brackets). */
export function taxBeforeRebates(taxableCents: number, table: TaxTable): number {
  if (taxableCents <= 0) return 0;
  let b = table.brackets[0];
  for (const br of table.brackets) if (taxableCents >= br.lower_cents) b = br;
  return b.base_cents + Math.round((taxableCents - b.lower_cents) * b.rate);
}

export function marginalRate(taxableCents: number, table: TaxTable): number {
  let rate = table.brackets[0].rate;
  for (const br of table.brackets) if (taxableCents >= br.lower_cents) rate = br.rate;
  return rate;
}

export function ageRebate(age: number, table: TaxTable): number {
  let r = table.rebate_primary_cents;
  if (age >= 65) r += table.rebate_secondary_cents;
  if (age >= 75) r += table.rebate_tertiary_cents;
  return r;
}

/** Annual medical scheme fee tax credit for `members` people (incl. main). */
export function medicalCreditsAnnual(members: number, table: TaxTable): number {
  if (members <= 0) return 0;
  const monthly =
    table.medical_main_cents +
    (members >= 2 ? table.medical_first_cents : 0) +
    Math.max(members - 2, 0) * table.medical_additional_cents;
  return monthly * 12;
}

export interface TaxInput {
  year: number;
  gross_annual_income_cents: number;
  age: number;
  medical_members: number;         // people on the medical scheme (incl. taxpayer)
  ra_contribution_cents: number;   // annual retirement-fund contributions
  other_deductions_cents: number;  // other allowable deductions (annual)
  donations_cents: number;         // s18A qualifying donations (annual)
  paye_paid_cents: number;         // PAYE withheld to date
}

export interface TaxResult {
  year: number;
  table_version: string;
  gross_income_cents: number;
  ra_deduction_cents: number;      // RA actually deductible (capped)
  ra_cap_cents: number;            // the applicable cap
  donation_deduction_cents: number;
  other_deductions_cents: number;
  taxable_income_cents: number;
  tax_before_rebates_cents: number;
  rebates_cents: number;
  medical_credits_cents: number;
  annual_tax_cents: number;
  effective_rate: number;
  marginal_rate: number;
  paye_paid_cents: number;
  refund_or_due_cents: number;     // >0 refund expected, <0 amount owing
  monthly_net_income_cents: number; // after tax only
  formula: string;
}

/** Full annual tax position for one taxpayer (§4.6). */
export function computeTax(input: TaxInput): TaxResult {
  const table = taxTable(input.year);
  const gross = Math.max(0, input.gross_annual_income_cents);

  const raCap = Math.min(table.ra_deduction_cap_cents, Math.round(table.ra_deduction_pct * gross));
  const raDed = Math.min(Math.max(0, input.ra_contribution_cents), raCap);
  const taxableBeforeDon = Math.max(0, gross - raDed - Math.max(0, input.other_deductions_cents));
  const donCap = Math.round(table.donation_pct_cap * taxableBeforeDon);
  const donDed = Math.min(Math.max(0, input.donations_cents), donCap);
  const taxable = Math.max(0, taxableBeforeDon - donDed);

  const before = taxBeforeRebates(taxable, table);
  const rebates = ageRebate(input.age, table);
  const medical = medicalCreditsAnnual(input.medical_members, table);
  const afterRebate = Math.max(0, before - rebates);
  const annualTax = Math.max(0, afterRebate - medical);

  return {
    year: input.year,
    table_version: table.version,
    gross_income_cents: gross,
    ra_deduction_cents: raDed,
    ra_cap_cents: raCap,
    donation_deduction_cents: donDed,
    other_deductions_cents: Math.max(0, input.other_deductions_cents),
    taxable_income_cents: taxable,
    tax_before_rebates_cents: before,
    rebates_cents: rebates,
    medical_credits_cents: medical,
    annual_tax_cents: annualTax,
    effective_rate: gross > 0 ? round6(annualTax / gross) : 0,
    marginal_rate: marginalRate(taxable, table),
    paye_paid_cents: input.paye_paid_cents,
    refund_or_due_cents: input.paye_paid_cents - annualTax,
    monthly_net_income_cents: Math.round((gross - annualTax) / 12),
    formula: "Taxable = gross − min(RA, 27.5%·gross, cap) − min(donations, 10%·taxable) − other; Tax = brackets(taxable) − rebates − medical credits",
  };
}

// ── Straight vs optimised (§4.7–4.9) ──────────────────────────────────────────
export interface TaxOptimisation {
  additional_ra_cents: number;       // extra retirement contribution to model
  additional_donation_cents: number; // extra qualifying donation to model
}

export interface TaxComparison {
  straight: TaxResult;
  optimised: TaxResult;
  tax_saving_cents: number;          // straight − optimised (BR: never shown without the cash cost)
  additional_cash_cents: number;     // extra contribution required
  net_cash_cost_cents: number;       // additional cash − tax saving
  effective_deduction_return: number; // tax saving ÷ additional cash
  monthly_takehome_impact_cents: number; // change to monthly take-home (negative = less cash now)
}

export function compareTax(base: TaxInput, opt: TaxOptimisation): TaxComparison {
  const straight = computeTax(base);
  const optimised = computeTax({
    ...base,
    ra_contribution_cents: base.ra_contribution_cents + Math.max(0, opt.additional_ra_cents),
    donations_cents: base.donations_cents + Math.max(0, opt.additional_donation_cents),
  });
  const saving = straight.annual_tax_cents - optimised.annual_tax_cents;
  const addCash = Math.max(0, opt.additional_ra_cents) + Math.max(0, opt.additional_donation_cents);
  const netCost = addCash - saving;
  return {
    straight, optimised,
    tax_saving_cents: saving,
    additional_cash_cents: addCash,
    net_cash_cost_cents: netCost,
    effective_deduction_return: addCash > 0 ? round6(saving / addCash) : 0,
    monthly_takehome_impact_cents: Math.round(-netCost / 12),
  };
}

/**
 * Suggest the tax-minimising extra retirement contribution subject to the
 * statutory cap, existing contributions and an affordability ceiling (§4.8).
 * RA lowers tax at the marginal rate up to the cap, so the optimum is to
 * contribute up to min(remaining cap, affordable).
 */
export function suggestRaTopUp(base: TaxInput, affordableAnnualCents: number): TaxComparison {
  const table = taxTable(base.year);
  const cap = Math.min(table.ra_deduction_cap_cents, Math.round(table.ra_deduction_pct * base.gross_annual_income_cents));
  const remaining = Math.max(0, cap - base.ra_contribution_cents);
  const topUp = Math.max(0, Math.min(remaining, affordableAnnualCents));
  return compareTax(base, { additional_ra_cents: topUp, additional_donation_cents: 0 });
}

// ── Payslip simulator (§4.11) ─────────────────────────────────────────────────
export interface PayslipInput {
  year: number;
  age: number;
  medical_members: number;
  // Monthly earnings
  basic_cents: number;
  allowances_cents: number;
  fringe_benefits_cents: number;
  // Monthly employee deductions that reduce taxable income
  retirement_employee_cents: number;
  // Monthly employee deductions that do NOT reduce taxable income
  medical_employee_cents: number;
  other_deductions_cents: number;
  // Monthly employer contributions
  retirement_employer_cents: number;
  medical_employer_cents: number;
}
export interface PayslipResult {
  total_earnings_cents: number;
  paye_cents: number;
  uif_employee_cents: number;
  total_deductions_cents: number;
  net_pay_cents: number;
  employer_uif_cents: number;
  employer_sdl_cents: number;
  total_employment_cost_cents: number;
  annualised_tax: TaxResult;
}

export function payslip(i: PayslipInput): PayslipResult {
  const table = taxTable(i.year);
  const taxableMonthly = i.basic_cents + i.allowances_cents + i.fringe_benefits_cents;
  const totalEarnings = taxableMonthly;
  // Annualise for PAYE. Retirement (employee + employer fringe) is deductible.
  const tax = computeTax({
    year: i.year, age: i.age, medical_members: i.medical_members,
    gross_annual_income_cents: taxableMonthly * 12,
    ra_contribution_cents: (i.retirement_employee_cents + i.retirement_employer_cents) * 12,
    other_deductions_cents: 0, donations_cents: 0, paye_paid_cents: 0,
  });
  const paye = Math.round(tax.annual_tax_cents / 12);
  const uifBase = Math.min(taxableMonthly, table.uif_monthly_ceiling_cents);
  const uifEmployee = Math.round(uifBase * table.uif_rate);
  const totalDeductions = paye + uifEmployee + i.retirement_employee_cents + i.medical_employee_cents + i.other_deductions_cents;
  const employerUif = Math.round(uifBase * table.uif_rate);
  const employerSdl = Math.round(taxableMonthly * table.sdl_rate);
  return {
    total_earnings_cents: totalEarnings,
    paye_cents: paye,
    uif_employee_cents: uifEmployee,
    total_deductions_cents: totalDeductions,
    net_pay_cents: totalEarnings - totalDeductions,
    employer_uif_cents: employerUif,
    employer_sdl_cents: employerSdl,
    total_employment_cost_cents: totalEarnings + i.retirement_employer_cents + i.medical_employer_cents + employerUif + employerSdl,
    annualised_tax: tax,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset acquisition — financing & amortisation (§5). Rates are nominal annual
// compounded monthly (r = annual/12), matching calc.monthlyBondRepayment.
// ─────────────────────────────────────────────────────────────────────────────

/** Financed amount (BR-006): price + financed costs − deposit. */
export function financedAmount(priceCents: number, depositCents: number, financedCostsCents = 0): number {
  return Math.max(0, priceCents + financedCostsCents - depositCents);
}

/**
 * Monthly instalment for an amortising loan, optionally amortising down to a
 * balloon/residual rather than to zero (§5.4).
 * PMT = (PV − B·(1+r)⁻ⁿ) · r / (1 − (1+r)⁻ⁿ).
 */
export function instalment(principalCents: number, annualRate: number, months: number, balloonCents = 0): number {
  if (months <= 0) return Math.max(0, principalCents - balloonCents);
  const r = annualRate / 12;
  if (r === 0) return Math.ceil((principalCents - balloonCents) / months);
  const disc = Math.pow(1 + r, -months);
  return Math.round(((principalCents - balloonCents * disc) * r) / (1 - disc));
}

export interface AmortInput {
  principal_cents: number;
  annual_rate: number;
  months: number;
  balloon_cents?: number;
  extra_monthly_cents?: number;      // additional principal each month
  lump_sums?: { month: number; amount_cents: number }[]; // once-off extra payments
  monthly_fee_cents?: number;        // recurring service fee (for NPV / cash obligation)
}

export interface AmortRow {
  month: number;
  payment_cents: number;   // scheduled instalment (excl. extra & fees)
  interest_cents: number;
  principal_cents: number; // principal portion incl. extra & lump this month
  fee_cents: number;
  balance_cents: number;
}

export interface AmortResult {
  monthly_instalment_cents: number;
  schedule: AmortRow[];
  months_to_payoff: number;
  total_interest_cents: number;
  total_fees_cents: number;
  total_paid_cents: number;
  total_principal_cents: number;
  balloon_cents: number;
}

/** Build the amortisation schedule (BR-007: balances come from the schedule). */
export function amortise(input: AmortInput): AmortResult {
  const months = clampMonths(input.months);
  const balloon = Math.max(0, input.balloon_cents ?? 0);
  const extra = Math.max(0, input.extra_monthly_cents ?? 0);
  const fee = Math.max(0, input.monthly_fee_cents ?? 0);
  const r = input.annual_rate / 12;
  const pay = instalment(input.principal_cents, input.annual_rate, months, balloon);
  const lumpByMonth = new Map<number, number>();
  for (const l of input.lump_sums ?? []) lumpByMonth.set(l.month, (lumpByMonth.get(l.month) ?? 0) + Math.max(0, l.amount_cents));

  let balance = input.principal_cents;
  let totalInterest = 0, totalFees = 0, totalPrincipal = 0;
  const schedule: AmortRow[] = [];
  let payoff = months;

  for (let m = 1; m <= months && balance > 0; m++) {
    const interest = Math.round(balance * r);
    let principalPortion = pay - interest + extra + (lumpByMonth.get(m) ?? 0);
    // Final scheduled month clears any balloon residual as well.
    if (m === months) principalPortion = balance;
    if (principalPortion > balance) principalPortion = balance;
    if (principalPortion < 0) principalPortion = 0;
    balance -= principalPortion;
    totalInterest += interest;
    totalFees += fee;
    totalPrincipal += principalPortion;
    schedule.push({
      month: m,
      payment_cents: pay,
      interest_cents: interest,
      principal_cents: principalPortion,
      fee_cents: fee,
      balance_cents: balance,
    });
    if (balance <= 0) { payoff = m; break; }
  }

  return {
    monthly_instalment_cents: pay,
    schedule,
    months_to_payoff: payoff,
    total_interest_cents: totalInterest,
    total_fees_cents: totalFees,
    total_paid_cents: totalInterest + totalPrincipal + totalFees,
    total_principal_cents: totalPrincipal,
    balloon_cents: balloon,
  };
}

export interface EarlyRepaymentResult {
  base: AmortResult;
  optimised: AmortResult;
  interest_saved_cents: number;
  interest_saved_pct: number;
  months_saved: number;
  additional_cash_cents: number; // extra paid over the optimised life
}

/** Compare a base contract against an optimised repayment strategy (§5.6, AC-006). */
export function earlyRepayment(base: AmortInput, optimised: AmortInput): EarlyRepaymentResult {
  const b = amortise(base);
  const o = amortise(optimised);
  const saved = b.total_interest_cents - o.total_interest_cents;
  return {
    base: b, optimised: o,
    interest_saved_cents: saved,
    interest_saved_pct: b.total_interest_cents > 0 ? round6(saved / b.total_interest_cents) : 0,
    months_saved: b.months_to_payoff - o.months_to_payoff,
    additional_cash_cents: o.total_principal_cents - b.total_principal_cents >= 0
      ? (o.total_paid_cents - o.total_interest_cents - o.total_fees_cents) - (b.total_paid_cents - b.total_interest_cents - b.total_fees_cents)
      : 0,
  };
}

/**
 * Maximum affordable loan/asset price given a maximum instalment (§5.7).
 * Inverts the annuity formula: PV = PMT·(1 − (1+r)⁻ⁿ)/r + B·(1+r)⁻ⁿ.
 */
export function maxAffordable(
  maxInstalmentCents: number, annualRate: number, months: number, depositCents: number, balloonCents = 0,
): { max_loan_cents: number; max_price_cents: number } {
  const r = annualRate / 12;
  let loan: number;
  if (r === 0) loan = maxInstalmentCents * months + balloonCents;
  else {
    const disc = Math.pow(1 + r, -months);
    loan = Math.round((maxInstalmentCents * (1 - disc)) / r + balloonCents * disc);
  }
  return { max_loan_cents: loan, max_price_cents: loan + depositCents };
}

export interface RateSensitivityRow {
  delta_bp: number;          // rate change in basis points (0, 100, 200, 300, custom)
  annual_rate: number;
  instalment_cents: number;
  additional_cost_cents: number; // vs the base instalment
  debt_service_ratio: number | null; // instalment ÷ net monthly income
  affordable: boolean;
}

/** Interest-rate stress test for variable-rate debt (§5.8, AC-007). */
export function rateSensitivity(
  principalCents: number, baseAnnualRate: number, months: number,
  netMonthlyIncomeCents: number, maxDsr = 0.35, balloonCents = 0,
  deltas: number[] = [0, 0.01, 0.02, 0.03],
): RateSensitivityRow[] {
  const baseInstalment = instalment(principalCents, baseAnnualRate, months, balloonCents);
  return deltas.map((d) => {
    const rate = baseAnnualRate + d;
    const inst = instalment(principalCents, rate, months, balloonCents);
    const dsr = netMonthlyIncomeCents > 0 ? round6(inst / netMonthlyIncomeCents) : null;
    return {
      delta_bp: Math.round(d * 10000),
      annual_rate: round6(rate),
      instalment_cents: inst,
      additional_cost_cents: inst - baseInstalment,
      debt_service_ratio: dsr,
      affordable: dsr == null ? false : dsr <= maxDsr,
    };
  });
}

/** Principal/interest position at a point in the loan term (§5.11). */
export function amortPoint(result: AmortResult, throughMonth: number, priceCents?: number) {
  let interest = 0, principal = 0, fees = 0, outstanding = result.schedule.at(-1)?.balance_cents ?? 0;
  let count = 0;
  for (const row of result.schedule) {
    if (row.month > throughMonth) break;
    interest += row.interest_cents;
    principal += row.principal_cents;
    fees += row.fee_cents;
    outstanding = row.balance_cents;
    count = row.month;
  }
  const totalPrincipal = result.total_principal_cents || 1;
  return {
    payments_made: count,
    interest_paid_cents: interest,
    principal_repaid_cents: principal,
    fees_paid_cents: fees,
    outstanding_cents: outstanding,
    equity_cents: priceCents != null ? priceCents - outstanding : principal,
    pct_repaid: round6(principal / totalPrincipal),
  };
}

/**
 * Present value of financing cost: discount the periodic interest + fee stream
 * at a user-defined annual discount rate (§5.12, monthly discounting).
 */
export function npvFinancingCost(result: AmortResult, annualDiscountRate: number): number {
  const dr = annualDiscountRate / 12;
  let pv = 0;
  for (const row of result.schedule) {
    pv += (row.interest_cents + row.fee_cents) / Math.pow(1 + dr, row.month);
  }
  return Math.round(pv);
}
