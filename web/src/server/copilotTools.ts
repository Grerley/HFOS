/**
 * Read-only, grounded tool layer for the agentic copilot.
 *
 * Every tool is a thin wrapper over the deterministic calc engine / services,
 * scoped to a single household. Money is returned as pre-formatted strings so
 * the model quotes figures verbatim and never does arithmetic — the grounding
 * contract that keeps answers factual. Tools NEVER mutate data.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { accounts, budgetLines, budgetPeriods, categories, goals as goalsTable, households, householdMembers, properties, propertyCashFlows } from "../db/schema";
import * as calc from "../lib/calc";
import { loadLinesForCalc } from "./services";
import { periodSettlement } from "./payments";
import { generatePeriodInsights } from "./insights";

const NW_LIABILITY_TYPES = new Set(["loan", "credit_card"]); // bonds counted via property equity
const NW_IGNORE_TYPES = new Set(["bond"]);

export interface ToolContext {
  env: Env;
  db: DB;
  householdId: number;
  /** When present (analyst mode), record_insight persists findings via this hook. */
  onInsight?: (f: InsightFinding) => Promise<void>;
}

export interface InsightFinding {
  type: string;
  severity: string;
  summary: string;
  explanation: string;
  action?: string;
  evidence?: Record<string, unknown>;
}

function fmtMoney(cents: number, currency: string): string {
  const v = (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${v}`;
}
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const points = (x: number, digits = 1) => `${(x * 100).toFixed(digits)} pts`;

async function currencyFor(db: DB, householdId: number): Promise<string> {
  const hh = (await db.select().from(households).where(eq(households.id, householdId))).at(0);
  return hh?.base_currency ?? "ZAR";
}

async function allPeriods(db: DB, householdId: number) {
  return db.select().from(budgetPeriods).where(eq(budgetPeriods.household_id, householdId)).orderBy(budgetPeriods.start_date);
}

/** id → member name for a household, so tools can label owners/payers by name. */
async function memberNameMap(db: DB, householdId: number): Promise<Map<number, string>> {
  const rows = await db.select().from(householdMembers).where(eq(householdMembers.household_id, householdId));
  return new Map(rows.map((m) => [m.id, m.name]));
}
const nameOf = (map: Map<number, string>, id?: number | null): string | null =>
  id != null ? map.get(id) ?? null : null;

async function resolvePeriod(db: DB, householdId: number, periodId?: number | null) {
  if (periodId != null) {
    const p = (await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(periodId)))).at(0);
    if (p && p.household_id === householdId) return p;
    return null;
  }
  return (await db.select().from(budgetPeriods).where(eq(budgetPeriods.household_id, householdId)).orderBy(desc(budgetPeriods.start_date)).limit(1)).at(0) ?? null;
}

// ── Tool schemas (Anthropic tool-use format) ─────────────────────────────────
export const COPILOT_TOOLS = [
  { name: "list_periods", description: "List the household's budget periods (months), newest last, with status and which is the latest. Call this first when you need a period id.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "period_financials", description: "Full financials for one budget period: planned & actual income, expenses, savings, net position, savings rate, income/expense/net variance, and the top expense categories with their share. Omit period_id for the latest period.", input_schema: { type: "object", properties: { period_id: { type: "integer", description: "Budget period id; omit for latest" } }, additionalProperties: false } },
  { name: "compare_periods", description: "Compare two budget periods and return the deltas (income, expenses, net, savings, savings-rate change) with direction.", input_schema: { type: "object", properties: { period_id_a: { type: "integer" }, period_id_b: { type: "integer" } }, required: ["period_id_a", "period_id_b"], additionalProperties: false } },
  { name: "financial_trends", description: "Time series across the most recent months: income, expenses, net, savings and savings-rate per period. Use this to spot trends, drift and turning points.", input_schema: { type: "object", properties: { months: { type: "integer", description: "How many recent periods (default 12)" } }, additionalProperties: false } },
  { name: "budget_lines", description: "Line-level detail for a period: each line's item name, category, type, the OWNER (which household member the line belongs to) and payer, plus planned, actual and variance. Use this to answer 'whose line is this' or 'how much is X's fuel'. Optionally filter by category_type (income|expense|saving|investment|transfer) or owner_name (case-insensitive match on the member's name). Omit period_id for the latest.", input_schema: { type: "object", properties: { period_id: { type: "integer" }, category_type: { type: "string" }, owner_name: { type: "string", description: "filter to lines owned by this member (partial, case-insensitive)" }, limit: { type: "integer" } }, additionalProperties: false } },
  { name: "owner_breakdown", description: "Per-member (owner) split of a period: each household member's income, expenses and net position, using each line's owner/allocation. Answers 'who earns/spends what' and 'whose money covers what'. Omit period_id for the latest.", input_schema: { type: "object", properties: { period_id: { type: "integer" }, basis: { type: "string", enum: ["planned", "actual"], description: "default planned" } }, additionalProperties: false } },
  { name: "household_members", description: "List the household members with their name, relationship and role. Use this to map a name the user mentions (e.g. a partner or child) to the owner labels used elsewhere.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "payments_status", description: "Settlement status for a period: total outstanding, overdue amount and count, debit orders to confirm, manual payments remaining, and completion %. Omit period_id for the latest.", input_schema: { type: "object", properties: { period_id: { type: "integer" } }, additionalProperties: false } },
  { name: "net_worth", description: "Household net worth: total assets, total liabilities (loans & credit cards), property equity, and the net figure. Also lists accounts by balance.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "goals", description: "All savings goals with progress, amount remaining, monthly required vs planned contribution, monthly shortfall, projected finish date and pace (on_track/behind/overdue/etc).", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "properties", description: "Property portfolio: per property the market value, outstanding bond, equity, loan-to-value, and monthly cash-flow surplus/shortfall with gross & net yield where cash-flow data exists.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "detect_insights", description: "Run the deterministic rule-based checks for a period (over-budget, low savings rate, overdue payments, goal risk, etc.) and return their findings as a starting signal to investigate further. Omit period_id for the latest.", input_schema: { type: "object", properties: { period_id: { type: "integer" } }, additionalProperties: false } },
] as const;

/** Analyst-only tool: appended when running the proactive insight agent. */
export const RECORD_INSIGHT_TOOL = {
  name: "record_insight",
  description: "Record ONE noteworthy finding for the household to review later. Call once per distinct finding (at most 5 total). Be specific and quote the figures you found via the other tools.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", description: "short slug, e.g. savings_drift, category_spike, goal_at_risk, cashflow_risk, opportunity" },
      severity: { type: "string", enum: ["info", "opportunity", "warning", "critical"] },
      summary: { type: "string", description: "one-line headline" },
      explanation: { type: "string", description: "2-3 sentences with the specific numbers and why it matters" },
      action: { type: "string", description: "a concrete suggested next step" },
    },
    required: ["type", "severity", "summary", "explanation"],
    additionalProperties: false,
  },
} as const;

// ── Executor ─────────────────────────────────────────────────────────────────
export async function executeCopilotTool(ctx: ToolContext, name: string, input: any): Promise<unknown> {
  const { db, householdId } = ctx;
  const cur = await currencyFor(db, householdId);

  switch (name) {
    case "list_periods": {
      const ps = await allPeriods(db, householdId);
      const latest = ps.at(-1);
      return {
        periods: ps.map((p) => ({ period_id: p.id, label: p.label, status: p.status, start_date: p.start_date, end_date: p.end_date, is_latest: p.id === latest?.id })),
      };
    }

    case "period_financials": {
      const p = await resolvePeriod(db, householdId, input?.period_id);
      if (!p) return { error: "No such period. Call list_periods." };
      const s = calc.periodSummary(await loadLinesForCalc(db, householdId, p.id));
      return {
        period: { period_id: p.id, label: p.label, status: p.status },
        planned: {
          income: fmtMoney(s.planned.total_income_cents, cur),
          expenses: fmtMoney(s.planned.total_expenses_cents, cur),
          savings: fmtMoney(s.planned.total_savings_cents, cur),
          net_position: fmtMoney(s.planned.net_position_cents, cur),
          savings_rate: pct(s.planned.savings_rate),
        },
        actual: {
          income: fmtMoney(s.actual.total_income_cents, cur),
          expenses: fmtMoney(s.actual.total_expenses_cents, cur),
          net_position: fmtMoney(s.actual.net_position_cents, cur),
        },
        variance: {
          income: fmtMoney(s.variance.income.variance_cents, cur),
          expenses: fmtMoney(s.variance.expenses.variance_cents, cur),
          net: fmtMoney(s.variance.net.variance_cents, cur),
        },
        top_expense_categories: s.category_breakdown.slice(0, 8).map((c) => ({ category: c.category_name ?? "Uncategorised", amount: fmtMoney(c.amount_cents, cur), share_of_expenses: pct(c.pct_of_expenses) })),
      };
    }

    case "compare_periods": {
      const a = await resolvePeriod(db, householdId, input?.period_id_a);
      const b = await resolvePeriod(db, householdId, input?.period_id_b);
      if (!a || !b) return { error: "One or both periods not found. Call list_periods." };
      const sa = calc.periodSummary(await loadLinesForCalc(db, householdId, a.id)).planned;
      const sb = calc.periodSummary(await loadLinesForCalc(db, householdId, b.id)).planned;
      const d = (x: number, y: number) => y - x;
      const dir = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
      return {
        from: { period_id: a.id, label: a.label },
        to: { period_id: b.id, label: b.label },
        deltas: {
          income: { change: fmtMoney(d(sa.total_income_cents, sb.total_income_cents), cur), direction: dir(d(sa.total_income_cents, sb.total_income_cents)) },
          expenses: { change: fmtMoney(d(sa.total_expenses_cents, sb.total_expenses_cents), cur), direction: dir(d(sa.total_expenses_cents, sb.total_expenses_cents)) },
          net_position: { change: fmtMoney(d(sa.net_position_cents, sb.net_position_cents), cur), direction: dir(d(sa.net_position_cents, sb.net_position_cents)) },
          savings: { change: fmtMoney(d(sa.total_savings_cents, sb.total_savings_cents), cur), direction: dir(d(sa.total_savings_cents, sb.total_savings_cents)) },
          savings_rate: { change: points(sb.savings_rate - sa.savings_rate), direction: dir(sb.savings_rate - sa.savings_rate) },
        },
      };
    }

    case "financial_trends": {
      const months = Math.max(1, Math.min(Number(input?.months) || 12, 36));
      const ps = (await allPeriods(db, householdId)).slice(-months);
      const series = [];
      for (const p of ps) {
        const s = calc.periodSummary(await loadLinesForCalc(db, householdId, p.id)).planned;
        series.push({ period_id: p.id, label: p.label, income: fmtMoney(s.total_income_cents, cur), expenses: fmtMoney(s.total_expenses_cents, cur), net: fmtMoney(s.net_position_cents, cur), savings: fmtMoney(s.total_savings_cents, cur), savings_rate: pct(s.savings_rate) });
      }
      return { count: series.length, series };
    }

    case "budget_lines": {
      const p = await resolvePeriod(db, householdId, input?.period_id);
      if (!p) return { error: "No such period. Call list_periods." };
      const limit = Math.max(1, Math.min(Number(input?.limit) || 30, 100));
      const typeFilter = input?.category_type ? String(input.category_type) : null;
      const ownerFilter = input?.owner_name ? String(input.owner_name).trim().toLowerCase() : null;

      const lineRows = await db.select().from(budgetLines)
        .where(and(eq(budgetLines.period_id, p.id), eq(budgetLines.household_id, householdId)));
      const catIds = [...new Set(lineRows.map((l) => l.category_id))];
      const cats = catIds.length ? await db.select().from(categories).where(inArray(categories.id, catIds)) : [];
      const catById = new Map(cats.map((c) => [c.id, c]));
      const members = await memberNameMap(db, householdId);

      const rows = lineRows
        .map((l) => {
          const cat = catById.get(l.category_id);
          const planned = l.planned_amount_cents ?? 0;
          const actual = l.actual_amount_cents ?? 0;
          const owner = nameOf(members, l.owner_member_id);
          return {
            item: l.item_name,
            category: cat?.name ?? "Uncategorised",
            type: cat?.type ?? "expense",
            owner: owner ?? "unassigned",
            payer: nameOf(members, l.payer_member_id),
            planned: fmtMoney(planned, cur),
            actual: fmtMoney(actual, cur),
            variance: fmtMoney(actual - planned, cur),
            _sort: planned,
            _type: cat?.type ?? "expense",
            _owner: (owner ?? "").toLowerCase(),
          };
        })
        .filter((r) => !typeFilter || r._type === typeFilter)
        .filter((r) => !ownerFilter || r._owner.includes(ownerFilter))
        .sort((x, y) => y._sort - x._sort)
        .slice(0, limit)
        .map(({ _sort, _type, _owner, ...r }) => r);
      return { period: { period_id: p.id, label: p.label }, count: rows.length, lines: rows };
    }

    case "owner_breakdown": {
      const p = await resolvePeriod(db, householdId, input?.period_id);
      if (!p) return { error: "No such period. Call list_periods." };
      const basis = input?.basis === "actual" ? "actual" : "planned";
      const lines = await loadLinesForCalc(db, householdId, p.id);
      const positions = calc.ownerPositions(lines, basis as any);
      const members = await memberNameMap(db, householdId);
      const owners = Object.entries(positions).map(([id, pos]) => ({
        owner: nameOf(members, Number(id)) ?? `member #${id}`,
        income: fmtMoney(pos.income_cents, cur),
        expenses: fmtMoney(pos.expense_cents, cur),
        net: fmtMoney(pos.net_cents, cur),
        _net: pos.net_cents,
      })).sort((a, b) => b._net - a._net).map(({ _net, ...o }) => o);
      return { period: { period_id: p.id, label: p.label }, basis, owners };
    }

    case "household_members": {
      const rows = await db.select().from(householdMembers).where(eq(householdMembers.household_id, householdId));
      return {
        members: rows.map((m) => ({ name: m.name, relationship: m.relationship_label ?? null, role: m.role, active: m.is_active })),
      };
    }

    case "payments_status": {
      const p = await resolvePeriod(db, householdId, input?.period_id);
      if (!p) return { error: "No such period. Call list_periods." };
      const settle = await periodSettlement(db, householdId, p.id);
      const sm: any = settle.summary;
      return {
        period: { period_id: p.id, label: p.label },
        outstanding: fmtMoney(sm.total_outstanding_cents, cur),
        overdue: fmtMoney(sm.total_overdue_cents, cur),
        overdue_count: sm.overdue_count,
        debit_orders_to_confirm: sm.debit_pending_count,
        manual_payments_remaining: sm.manual_remaining_count,
        completion: pct(sm.completion_pct, 0),
      };
    }

    case "net_worth": {
      const accRows = await db.select().from(accounts).where(eq(accounts.household_id, householdId));
      const assetAccts = accRows.filter((a) => !NW_LIABILITY_TYPES.has(a.type) && !NW_IGNORE_TYPES.has(a.type));
      const liabAccts = accRows.filter((a) => NW_LIABILITY_TYPES.has(a.type));
      const propRows = await db.select().from(properties).where(eq(properties.household_id, householdId));
      const propertyEquity = propRows.reduce((sum, pr) => sum + calc.propertyEquity(pr.market_value_cents, pr.outstanding_bond_cents, pr.ownership_share_bp), 0);
      const base = calc.netWorth(assetAccts.map((a) => a.current_balance_cents), liabAccts.map((a) => a.current_balance_cents));
      return {
        assets: fmtMoney(assetAccts.reduce((s, a) => s + a.current_balance_cents, 0), cur),
        liabilities: fmtMoney(liabAccts.reduce((s, a) => s + a.current_balance_cents, 0), cur),
        property_equity: fmtMoney(propertyEquity, cur),
        net_worth: fmtMoney(base + propertyEquity, cur),
        accounts: accRows.map((a) => ({ name: a.name, type: a.type, balance: fmtMoney(a.current_balance_cents, cur) })),
      };
    }

    case "goals": {
      const rows = await db.select().from(goalsTable).where(eq(goalsTable.household_id, householdId)).orderBy(desc(goalsTable.priority));
      return {
        goals: rows.map((g) => {
          const months = g.target_date ? monthsBetween(g.target_date) : 0;
          const required = calc.goalMonthlyRequirement(g.target_amount_cents, g.current_amount_cents, months);
          const pace = calc.goalPace(calc.goalProgress(g.target_amount_cents, g.current_amount_cents), !!g.target_date, months, g.monthly_contribution_cents, required);
          return {
            name: g.name,
            progress: pct(calc.goalProgress(g.target_amount_cents, g.current_amount_cents), 0),
            saved: fmtMoney(g.current_amount_cents, cur),
            target: fmtMoney(g.target_amount_cents, cur),
            remaining: fmtMoney(calc.goalRemainingCents(g.target_amount_cents, g.current_amount_cents), cur),
            target_date: g.target_date ?? null,
            monthly_required: fmtMoney(required, cur),
            monthly_contribution: fmtMoney(g.monthly_contribution_cents, cur),
            monthly_shortfall: fmtMoney(calc.goalMonthlyShortfall(required, g.monthly_contribution_cents), cur),
            pace,
          };
        }),
      };
    }

    case "properties": {
      const propRows = await db.select().from(properties).where(eq(properties.household_id, householdId));
      const out = [];
      for (const pr of propRows) {
        const cf = (await db.select().from(propertyCashFlows).where(eq(propertyCashFlows.property_id, pr.id)).orderBy(desc(propertyCashFlows.id)).limit(1)).at(0);
        const equity = calc.propertyEquity(pr.market_value_cents, pr.outstanding_bond_cents, pr.ownership_share_bp);
        const base: any = { name: pr.name, market_value: fmtMoney(pr.market_value_cents, cur), outstanding_bond: fmtMoney(pr.outstanding_bond_cents, cur), equity: fmtMoney(equity, cur), loan_to_value: pct(calc.loanToValue(pr.outstanding_bond_cents, pr.market_value_cents)), rental_status: pr.rental_status };
        if (cf) {
          const flow = calc.propertyCashFlow({ rent_cents: cf.rent_cents, bond_cents: cf.bond_cents, levies_cents: cf.levies_cents, rates_cents: cf.rates_cents, utilities_cents: cf.utilities_cents, insurance_cents: cf.insurance_cents, maintenance_cents: cf.maintenance_cents, agent_fees_cents: cf.agent_fees_cents, vacancy_cents: cf.vacancy_cents, other_cents: cf.other_cents });
          base.monthly_cash_flow = fmtMoney(flow.surplus_shortfall_cents, cur);
          base.gross_yield = pct(calc.grossRentalYield(cf.rent_cents * 12, pr.market_value_cents), 2);
        }
        out.push(base);
      }
      return { properties: out };
    }

    case "detect_insights": {
      const p = await resolvePeriod(db, householdId, input?.period_id);
      if (!p) return { error: "No such period. Call list_periods." };
      const found = await generatePeriodInsights(db, householdId, p.id);
      return { period: { period_id: p.id, label: p.label }, findings: found.map((f: any) => ({ type: f.type, severity: f.severity, summary: f.summary, explanation: f.explanation })) };
    }

    case "record_insight": {
      if (!ctx.onInsight) return { error: "record_insight is only available during scheduled analysis." };
      await ctx.onInsight({ type: String(input?.type || "insight"), severity: String(input?.severity || "info"), summary: String(input?.summary || "").slice(0, 300), explanation: String(input?.explanation || "").slice(0, 2000), action: input?.action ? String(input.action).slice(0, 500) : undefined });
      return { ok: true };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/** Months from now until an ISO date, floored at 0 (mirrors router's helper). */
function monthsBetween(target: string): number {
  const t = new Date(target);
  const now = new Date();
  return Math.max((t.getFullYear() - now.getFullYear()) * 12 + (t.getMonth() - now.getMonth()), 0);
}
