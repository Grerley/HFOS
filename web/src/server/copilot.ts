/**
 * LLM copilot layer.
 *
 * Design principle (non-negotiable): the deterministic calculation engine is the
 * ONLY source of numbers. We compute a structured, pre-formatted "facts" bundle
 * server-side and hand it to the model with a strict grounding prompt. The model
 * may only phrase and reason over those facts — it never does arithmetic. If the
 * model is unavailable, errors, or times out, we fall back to the rule-based
 * answer, so the copilot is always at least as good as the deterministic engine.
 */
import { desc, eq } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { accounts, budgetPeriods, goals as goalsTable, households } from "../db/schema";
import * as calc from "../lib/calc";
import { loadLinesForCalc } from "./services";
import { periodSettlement } from "./payments";
import { answerQuestion } from "./insights";

const LIABILITY_TYPES = new Set(["loan", "credit_card", "bond"]);
const LLM_TIMEOUT_MS = 9000;

// Per-provider default models (each overridable via HFOS_COPILOT_MODEL).
// Native Workers AI model — free-tier, in-region. fp8-fast supersedes the
// deprecated "@cf/meta/llama-3.1-8b-instruct" and is cheaper + faster.
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
// Claude via Cloudflare AI Gateway (Unified Billing, no key). Cloudflare's
// catalog uses dotted names; bump this as newer Claude models are listed.
const DEFAULT_AI_GATEWAY_MODEL = "anthropic/claude-sonnet-4.5";
// Direct Anthropic API (needs ANTHROPIC_API_KEY).
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const DEFAULT_AI_GATEWAY_ID = "default";

function money(cents: number, currency: string) {
  const v = (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${v}`;
}

/** Pre-formatted, model-safe facts. All money is a string so the model quotes it verbatim. */
async function buildFacts(db: DB, householdId: number, periodId: number) {
  const hh = (await db.select().from(households).where(eq(households.id, householdId))).at(0);
  const currency = hh?.base_currency ?? "ZAR";
  const period = (await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, periodId))).at(0);
  const lines = await loadLinesForCalc(db, householdId, periodId);
  const summary = calc.periodSummary(lines);
  const p = summary.planned;

  const settle = await periodSettlement(db, householdId, periodId);
  const sm = settle.summary;

  const accRows = await db.select().from(accounts).where(eq(accounts.household_id, householdId));
  const netWorth = calc.netWorth(
    accRows.filter((a) => !LIABILITY_TYPES.has(a.type)).map((a) => a.current_balance_cents),
    accRows.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.current_balance_cents),
  );

  const goalRows = await db.select().from(goalsTable).where(eq(goalsTable.household_id, householdId)).orderBy(desc(goalsTable.priority));

  return {
    currency,
    period: period ? { label: period.label, status: period.status } : null,
    planned: {
      income: money(p.total_income_cents, currency),
      expenses: money(p.total_expenses_cents, currency),
      surplus_or_shortfall: money(p.net_position_cents, currency),
      savings: money(p.total_savings_cents, currency),
      savings_rate: `${(p.savings_rate * 100).toFixed(1)}%`,
    },
    variance: {
      income: money(summary.variance.income.variance_cents, currency),
      expenses: money(summary.variance.expenses.variance_cents, currency),
      net: money(summary.variance.net.variance_cents, currency),
    },
    top_expense_categories: summary.category_breakdown.slice(0, 5).map((c) => ({
      category: c.category_name ?? "Uncategorised",
      amount: money(c.amount_cents, currency),
      share: `${(c.pct_of_expenses * 100).toFixed(1)}%`,
    })),
    payments: {
      outstanding: money(sm.total_outstanding_cents, currency),
      overdue: money(sm.total_overdue_cents, currency),
      overdue_count: sm.overdue_count,
      debit_orders_to_confirm: sm.debit_pending_count,
      manual_payments_remaining: sm.manual_remaining_count,
      completion: `${(sm.completion_pct * 100).toFixed(0)}%`,
    },
    net_worth: money(netWorth, currency),
    goals: goalRows.slice(0, 8).map((g) => ({
      name: g.name,
      progress: `${(calc.goalProgress(g.target_amount_cents, g.current_amount_cents) * 100).toFixed(0)}%`,
      target: money(g.target_amount_cents, currency),
      saved: money(g.current_amount_cents, currency),
    })),
  };
}

const SYSTEM_PROMPT = `You are HFOS, a calm, precise household-finance copilot for a South African family.
You will receive a JSON object called FACTS containing figures already computed by a deterministic engine, and the user's QUESTION.

Rules — follow all of them:
- Use ONLY the numbers in FACTS. Never invent, estimate, or recompute any figure. Quote money and percentages exactly as written in FACTS (they are pre-formatted strings).
- If FACTS does not contain what's needed to answer, say so plainly and point to the relevant HFOS section (Planner, Payments, Cash flow, Goals, Property, Scenarios).
- Be concise: 2–4 sentences, warm and practical. No headings, no markdown, no bullet symbols.
- Terminology is South African (ZAR, bond, debit order, levies). Never give regulated financial advice; frame suggestions as options to consider.`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("llm_timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const userContent = (facts: unknown, question: string) =>
  `FACTS:\n${JSON.stringify(facts)}\n\nQUESTION: ${question}`;

/**
 * Extract the answer text across the three response shapes we may see:
 *  - Workers AI native (@cf/*):            { response: "..." }
 *  - AI Gateway → Anthropic-compatible:    { content: [{ type, text }] }
 *  - OpenAI-compatible fallback shape:     { choices: [{ message: { content } }] }
 */
function extractText(out: any): string {
  if (typeof out?.response === "string" && out.response.trim()) return out.response.trim();
  if (Array.isArray(out?.content)) {
    const t = out.content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("").trim();
    if (t) return t;
  }
  const c = out?.choices?.[0]?.message?.content;
  if (typeof c === "string" && c.trim()) return c.trim();
  return "";
}

/** Native Workers AI (open model on Cloudflare's GPUs). Free-tier, in-region, no key. */
async function runWorkersAI(env: Env, model: string, facts: unknown, question: string): Promise<string> {
  const ai: any = (env as any).AI;
  const out: any = await withTimeout(
    ai.run(model, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent(facts, question) },
      ],
      max_tokens: 400,
    }),
    LLM_TIMEOUT_MS,
  );
  const text = extractText(out);
  if (!text) throw new Error("empty_llm_response");
  return text;
}

/**
 * Claude via the same AI binding, routed through Cloudflare AI Gateway.
 * Third-party models bill through Unified Billing — Cloudflare manages the
 * Anthropic credentials, so there is no API key to hold. Requires an AI
 * Gateway and loaded credits on the account.
 */
async function runAiGateway(env: Env, model: string, gatewayId: string, facts: unknown, question: string): Promise<string> {
  const ai: any = (env as any).AI;
  const out: any = await withTimeout(
    ai.run(
      model,
      {
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent(facts, question) }],
      },
      { gateway: { id: gatewayId } },
    ),
    LLM_TIMEOUT_MS,
  );
  const text = extractText(out);
  if (!text) throw new Error("empty_llm_response");
  return text;
}

/** Direct Anthropic API (needs ANTHROPIC_API_KEY). */
async function runAnthropic(env: Env, model: string, facts: unknown, question: string): Promise<string> {
  const key = (env as any).ANTHROPIC_API_KEY as string;
  const res = await withTimeout(
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent(facts, question) }],
      }),
    }),
    LLM_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`anthropic_${res.status}`);
  const data: any = await res.json();
  const text = extractText(data);
  if (!text) throw new Error("empty_llm_response");
  return text;
}

type CopilotAttempt = { name: string; run: (facts: unknown) => Promise<string> };

/**
 * Answer a copilot question. Always computes the deterministic rule-based result;
 * upgrades to an LLM phrasing when a provider is configured and available.
 *
 * Providers (HFOS_COPILOT_PROVIDER):
 *   "auto"        cost-first — free native Workers AI on every request, spilling
 *                 over to Claude (AI Gateway) only when the native call fails
 *                 (e.g. the daily free-tier allowance is spent), then rules.
 *   "ai-gateway"  Claude first, degrading to the native model, then rules.
 *   "anthropic"   direct Anthropic API first, degrading to native, then rules.
 *   "workers-ai"  native model only, then rules.
 *   "rules"       deterministic only.
 *
 * Whatever the order, the chain always ends at the deterministic rule engine, so
 * a missing credential, spent free tier, unloaded credits, quota cap, or outage
 * never breaks the copilot.
 */
export async function copilotAnswer(env: Env, db: DB, householdId: number, question: string, periodId: number | null) {
  const rule = await answerQuestion(db, householdId, question, periodId);
  const provider = (env.HFOS_COPILOT_PROVIDER ?? "rules").toLowerCase();

  // No period, no LLM value-add — return the deterministic prompt.
  if (periodId == null || provider === "rules") return rule;

  const hasAI = !!(env as any).AI;
  const hasKey = !!(env as any).ANTHROPIC_API_KEY;
  const model = env.HFOS_COPILOT_MODEL;
  const gatewayId = env.HFOS_AI_GATEWAY_ID || DEFAULT_AI_GATEWAY_ID;

  // Reusable attempt builders. In "auto" mode HFOS_COPILOT_MODEL tunes the Claude
  // spill-over tier (the native tier stays on the free default).
  const nativeAttempt: CopilotAttempt = { name: "workers-ai", run: (f) => runWorkersAI(env, DEFAULT_WORKERS_AI_MODEL, f, question) };
  const gatewayAttempt: CopilotAttempt = { name: "ai-gateway", run: (f) => runAiGateway(env, model || DEFAULT_AI_GATEWAY_MODEL, gatewayId, f, question) };
  const anthropicAttempt: CopilotAttempt = { name: "anthropic", run: (f) => runAnthropic(env, model || DEFAULT_ANTHROPIC_MODEL, f, question) };

  const attempts: CopilotAttempt[] = [];
  if (provider === "auto") {
    // Cheapest that works, first: free native → Claude spill-over → rules.
    if (hasAI) {
      attempts.push(nativeAttempt);
      attempts.push(gatewayAttempt);
    } else if (hasKey) {
      attempts.push(anthropicAttempt);
    }
  } else if (provider === "ai-gateway" && hasAI) {
    attempts.push(gatewayAttempt, nativeAttempt);
  } else if (provider === "anthropic" && hasKey) {
    attempts.push(anthropicAttempt);
    if (hasAI) attempts.push(nativeAttempt);
  } else if (provider === "workers-ai" && hasAI) {
    attempts.push({ name: "workers-ai", run: (f) => runWorkersAI(env, model || DEFAULT_WORKERS_AI_MODEL, f, question) });
  }

  if (attempts.length === 0) return rule; // provider requested but unavailable → safe fallback

  let facts: unknown;
  try {
    facts = await buildFacts(db, householdId, periodId);
  } catch {
    return rule;
  }

  for (const attempt of attempts) {
    try {
      const answer = await attempt.run(facts);
      return {
        answer,
        citations: [{ source: "calculation_engine", period_id: periodId, facts }],
        matched_intent: rule.matched_intent,
        provider: attempt.name,
        grounded: true,
      };
    } catch {
      // Try the next attempt in the chain.
    }
  }

  // Every LLM attempt failed → deterministic rules answer.
  return { ...rule, provider: "rules", degraded: true };
}
