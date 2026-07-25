import { toCents } from "@/lib/format";

// Client-side draft shapes for the scenario builder. Amounts are kept as strings
// (raw input) and converted to integer cents only when sent to the server.

export interface EventDraft {
  id: string;         // client-only key
  kind: string;
  month: number;
  amount?: string;    // major units
  pct?: number;       // whole percent (e.g. -50)
  end_month?: number | null;
  price?: string;
  deposit?: string;
  annual_rate?: number; // whole percent
  term_months?: number;
  rent?: string;
  clears?: string;    // liability cleared on sale (major units)
  label?: string;
}

export interface ScenarioDraft {
  name: string;
  description: string;
  horizon_years: number;
  annual_inflation: number;          // whole percent
  annual_income_growth: number;
  annual_investment_return: number;
  annual_cash_return: number;
  events: EventDraft[];
}

export const GLOBAL_DEFAULTS = {
  annual_inflation: 5,
  annual_income_growth: 5,
  annual_investment_return: 10,
  annual_cash_return: 4,
};

export function blankDraft(): ScenarioDraft {
  return {
    name: "",
    description: "",
    horizon_years: 5,
    ...GLOBAL_DEFAULTS,
    events: [],
  };
}

// Which input fields each event kind exposes, and a human label.
export const EVENT_TYPES: { kind: string; label: string; fields: string[]; help?: string }[] = [
  { kind: "income_delta", label: "Income change", fields: ["month", "pct", "amount"], help: "A raise, a cut, or a job loss — applies from that month onward. Use a % (e.g. −50 to lose one salary) and/or a rand amount." },
  { kind: "expense_delta", label: "Living-cost change", fields: ["month", "pct", "amount"], help: "A step change in monthly living costs from that month." },
  { kind: "one_off_income", label: "One-off income (bonus / windfall)", fields: ["month", "amount"], help: "A single cash inflow in one month." },
  { kind: "one_off_expense", label: "One-off expense", fields: ["month", "amount"], help: "A single big cost in one month." },
  { kind: "recurring_income", label: "New recurring income", fields: ["month", "amount", "end_month"], help: "An ongoing monthly inflow (e.g. a side income). Leave 'until' blank to run to the horizon." },
  { kind: "recurring_expense", label: "New recurring expense", fields: ["month", "amount", "end_month"], help: "An ongoing monthly cost (e.g. a new dependent, school fees)." },
  { kind: "contribution_delta", label: "Change monthly saving", fields: ["month", "amount"], help: "Increase (+) or decrease (−) the amount you invest each month." },
  { kind: "lump_sum_invest", label: "Invest a lump sum", fields: ["month", "amount"], help: "Move cash into investments in one month." },
  { kind: "debt_extra_payment", label: "Extra debt payment", fields: ["month", "amount"], help: "A one-off extra payment that reduces your debt (and cash)." },
  { kind: "property_purchase", label: "Buy property", fields: ["month", "price", "deposit", "annual_rate", "term_months", "rent"], help: "Deposit leaves cash; a bond repayment becomes a monthly cost; optional rent is monthly income." },
  { kind: "property_sale", label: "Sell property", fields: ["month", "price", "clears"], help: "Net proceeds arrive as cash; any bond it clears reduces your debt." },
];

export const eventMeta = (kind: string) => EVENT_TYPES.find((e) => e.kind === kind) ?? EVENT_TYPES[0];

let seq = 0;
export function newEvent(kind = "income_delta"): EventDraft {
  seq += 1;
  return { id: `e${seq}_${kind}`, kind, month: 1, pct: 0 };
}

/** A short human summary of one event, for the review/list views. */
export function describeEvent(e: EventDraft, money: (major: number) => string): string {
  const at = ` at m${e.month}`;
  const amt = e.amount ? money(Number(e.amount) || 0) : "";
  switch (e.kind) {
    case "income_delta": return `Income ${e.pct ? `${e.pct > 0 ? "+" : ""}${e.pct}%` : ""}${e.amount ? ` ${Number(e.amount) >= 0 ? "+" : ""}${amt}` : ""}${at}`;
    case "expense_delta": return `Living costs ${e.pct ? `${e.pct > 0 ? "+" : ""}${e.pct}%` : ""}${e.amount ? ` ${amt}` : ""}${at}`;
    case "one_off_income": return `Windfall ${amt}${at}`;
    case "one_off_expense": return `One-off cost ${amt}${at}`;
    case "recurring_income": return `+${amt}/mo income (m${e.month}${e.end_month ? `–${e.end_month}` : "+"})`;
    case "recurring_expense": return `+${amt}/mo cost (m${e.month}${e.end_month ? `–${e.end_month}` : "+"})`;
    case "contribution_delta": return `Saving ${Number(e.amount) >= 0 ? "+" : ""}${amt}/mo${at}`;
    case "lump_sum_invest": return `Invest ${amt} lump sum${at}`;
    case "debt_extra_payment": return `Pay down debt ${amt}${at}`;
    case "property_purchase": return `Buy property ${e.price ? money(Number(e.price) || 0) : ""}${at}`;
    case "property_sale": return `Sell property ${e.price ? money(Number(e.price) || 0) : ""}${at}`;
    default: return `${e.kind}${at}`;
  }
}

/** Serialize a draft event into the server ScenarioEvent shape (integer cents, fractions). */
export function serializeEvent(e: EventDraft): Record<string, any> {
  const out: Record<string, any> = { kind: e.kind, month: Math.max(1, Math.round(e.month || 1)) };
  if (e.label) out.label = e.label;
  if (e.pct) out.pct = e.pct / 100;
  if (e.amount && Number(e.amount)) out.amount_cents = toCents(e.amount);
  if (e.end_month) out.end_month = Math.round(e.end_month);
  if (e.kind === "property_purchase") {
    out.price_cents = e.price ? toCents(e.price) : 0;
    out.deposit_cents = e.deposit ? toCents(e.deposit) : 0;
    out.annual_rate = (e.annual_rate ?? 11.5) / 100;
    out.term_months = e.term_months ?? 240;
    if (e.rent) out.rent_cents = toCents(e.rent);
  }
  if (e.kind === "property_sale") {
    out.price_cents = e.price ? toCents(e.price) : 0; // net proceeds
    if (e.clears) out.clears_liability_cents = toCents(e.clears);
  }
  return out;
}

/** Build the full assumptions_json payload (v2) from a draft. */
export function serializeDraft(d: ScenarioDraft): Record<string, any> {
  return {
    version: 2,
    horizon_months: Math.round(d.horizon_years * 12),
    annual_inflation: d.annual_inflation / 100,
    annual_income_growth: d.annual_income_growth / 100,
    annual_investment_return: d.annual_investment_return / 100,
    annual_cash_return: d.annual_cash_return / 100,
    events: d.events.map(serializeEvent),
  };
}

const centsToInput = (c: number | null | undefined): string | undefined => (c != null ? String(Math.round(c) / 100) : undefined);

/** Rebuild an editable draft from a stored v2 assumptions payload. */
export function draftFromAssumptions(name: string, description: string | null | undefined, a: Record<string, any> | null | undefined): ScenarioDraft {
  const d = blankDraft();
  d.name = name;
  d.description = description ?? "";
  if (!a) return d;
  d.horizon_years = a.horizon_months ? Math.max(1, Math.round(a.horizon_months / 12)) : d.horizon_years;
  const pctOf = (v: any, def: number) => (typeof v === "number" ? Math.round(v * 1000) / 10 : def);
  d.annual_inflation = pctOf(a.annual_inflation, d.annual_inflation);
  d.annual_income_growth = pctOf(a.annual_income_growth, d.annual_income_growth);
  d.annual_investment_return = pctOf(a.annual_investment_return, d.annual_investment_return);
  d.annual_cash_return = pctOf(a.annual_cash_return, d.annual_cash_return);
  d.events = Array.isArray(a.events) ? a.events.map(deserializeEvent) : [];
  return d;
}

function deserializeEvent(e: Record<string, any>): EventDraft {
  const d = newEvent(e.kind || "income_delta");
  d.month = e.month ?? 1;
  if (e.pct != null) d.pct = Math.round(e.pct * 1000) / 10;
  if (e.amount_cents != null) d.amount = centsToInput(e.amount_cents);
  if (e.end_month != null) d.end_month = e.end_month;
  if (e.label) d.label = e.label;
  if (e.kind === "property_purchase") {
    d.price = centsToInput(e.price_cents);
    d.deposit = centsToInput(e.deposit_cents);
    d.annual_rate = e.annual_rate != null ? Math.round(e.annual_rate * 1000) / 10 : 11.5;
    d.term_months = e.term_months ?? 240;
    if (e.rent_cents) d.rent = centsToInput(e.rent_cents);
  }
  if (e.kind === "property_sale") {
    d.price = centsToInput(e.price_cents);
    if (e.clears_liability_cents) d.clears = centsToInput(e.clears_liability_cents);
  }
  return d;
}

// ── Template gallery ──────────────────────────────────────────────────────────
export interface ScenarioTemplate {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  build: () => ScenarioDraft;
}

export const TEMPLATES: ScenarioTemplate[] = [
  {
    id: "job_loss",
    icon: "🛟",
    title: "Job loss / income shock",
    blurb: "Lose one salary for a while, then recover — see how long your cash lasts.",
    build: () => ({
      ...blankDraft(),
      name: "If we lose one salary",
      description: "One income stops for 6 months, then returns.",
      horizon_years: 3,
      events: [
        { ...newEvent("income_delta"), month: 1, pct: -50, label: "Lose one salary" },
        { ...newEvent("income_delta"), month: 7, pct: 100, label: "Back to work" },
      ],
    }),
  },
  {
    id: "buy_home",
    icon: "🏡",
    title: "Buy a home",
    blurb: "Deposit + bond repayment + rates — model the net-worth impact over 10 years.",
    build: () => ({
      ...blankDraft(),
      name: "Buy a home",
      description: "Deposit now, bond repayment monthly.",
      horizon_years: 10,
      events: [
        { ...newEvent("property_purchase"), month: 3, price: "2000000", deposit: "200000", annual_rate: 11.5, term_months: 240, label: "Home purchase" },
        { ...newEvent("recurring_expense"), month: 3, amount: "3500", label: "Rates & levies" },
      ],
    }),
  },
  {
    id: "new_dependent",
    icon: "👶",
    title: "New baby / dependent",
    blurb: "A step-up in monthly costs plus a one-off setup cost.",
    build: () => ({
      ...blankDraft(),
      name: "New dependent",
      description: "Ongoing monthly costs plus initial setup.",
      horizon_years: 5,
      events: [
        { ...newEvent("one_off_expense"), month: 1, amount: "20000", label: "Setup cost" },
        { ...newEvent("recurring_expense"), month: 1, amount: "4500", label: "Monthly care" },
      ],
    }),
  },
  {
    id: "fire",
    icon: "🔥",
    title: "Aggressive saving (FIRE)",
    blurb: "Cut spending and raise contributions — track the path to a bigger net worth.",
    build: () => ({
      ...blankDraft(),
      name: "Aggressive saving",
      description: "Trim living costs and invest the difference.",
      horizon_years: 10,
      annual_investment_return: 11,
      events: [
        { ...newEvent("expense_delta"), month: 1, pct: -20, label: "Cut discretionary spend" },
        { ...newEvent("contribution_delta"), month: 1, amount: "5000", label: "Invest more" },
      ],
    }),
  },
];
