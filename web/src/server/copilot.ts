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
import { and, desc, eq, lte } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { accounts, budgetPeriods, copilotMessages, goals as goalsTable, households } from "../db/schema";
import * as calc from "../lib/calc";
import { loadLinesForCalc } from "./services";
import { periodSettlement } from "./payments";
import { answerQuestion } from "./insights";
import { COPILOT_TOOLS, executeCopilotTool, type ToolContext } from "./copilotTools";

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

// ── Agentic layer ─────────────────────────────────────────────────────────────
// The model drives: it calls read-only, engine-backed tools to gather exactly
// the data it needs, reasons over multiple steps, then answers — grounded in the
// figures the tools return. Numbers still come only from the deterministic engine.

const AGENT_TIMEOUT_MS = 30_000; // whole loop budget
const AGENT_CALL_TIMEOUT_MS = 20_000; // single model round trip
const AGENT_MAX_ITERS = 6;
const AGENT_MAX_TOKENS = 1500;

export const AGENT_SYSTEM = `You are HFOS, a sharp, warm personal-CFO copilot for a South African household.
You have READ-ONLY tools that return figures already computed by a deterministic engine.

How to work:
- Investigate before answering. Call tools to get real numbers; for anything analytical, prefer trends and period comparisons over a single snapshot. Call list_periods first if you need a period id.
- Ground every figure in a tool result. Quote money and percentages EXACTLY as the tools return them (they are pre-formatted strings). Never invent, estimate, or recompute a number — if you need a figure you don't have, call a tool.
- Budget lines carry an OWNER (the household member a line belongs to). When the user asks whose line something is, or about a specific person's income/expenses, use budget_lines (owner/payer are included; filter by owner_name), owner_breakdown (per-member income/expenses/net) and household_members (to resolve a name). If a line's owner is "unassigned", say so rather than guessing.
- Be genuinely useful: answer the question, then surface the "why" and any notable trend, risk or opportunity the user may not have spotted. Stay concise and skimmable — short paragraphs; a few plain bullet points ("- ") are fine.
- South African terminology (ZAR, bond, debit order, levies). Never give regulated financial advice; frame suggestions as options to consider.
- You cannot change any data — you only read and analyse. If data is missing, say so plainly.`;

export type ConvMessage = { role: "user" | "assistant"; content: any };
export type Transport = { kind: "ai-gateway"; model: string; gatewayId: string } | { kind: "anthropic"; model: string };

export interface AgentRun {
  system: string;
  messages: ConvMessage[];
  tools: any[];
  transport: Transport;
  onInsight?: ToolContext["onInsight"];
  maxIters?: number;
}

/** One Messages-API round trip, via AI Gateway binding (no key) or direct Anthropic. */
async function callMessages(env: Env, transport: Transport, system: string, messages: ConvMessage[], tools: any[]): Promise<{ content: any[]; stop_reason: string }> {
  const body: any = { max_tokens: AGENT_MAX_TOKENS, system, messages };
  if (tools.length) body.tools = tools;

  let out: any;
  if (transport.kind === "ai-gateway") {
    const ai: any = (env as any).AI;
    out = await withTimeout(ai.run(transport.model, body, { gateway: { id: transport.gatewayId } }), AGENT_CALL_TIMEOUT_MS);
  } else {
    const key = (env as any).ANTHROPIC_API_KEY as string;
    const res = await withTimeout(
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: transport.model, ...body }),
      }),
      AGENT_CALL_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`anthropic_${res.status}`);
    out = await res.json();
  }
  // Normalise across binding envelopes → the Anthropic message shape.
  const msg = out?.content ? out : out?.result ?? out?.response ?? out;
  const content = Array.isArray(msg?.content) ? msg.content : [];
  return { content, stop_reason: msg?.stop_reason ?? "end_turn" };
}

/** Run the tool-use loop and return the final text plus the tools it consulted. */
export async function runAgent(env: Env, db: DB, householdId: number, cfg: AgentRun): Promise<{ answer: string; trace: { tool: string; input: unknown }[] }> {
  const toolCtx: ToolContext = { env, db, householdId, onInsight: cfg.onInsight };
  const convo: ConvMessage[] = [...cfg.messages];
  const trace: { tool: string; input: unknown }[] = [];
  const started = Date.now();
  const maxIters = cfg.maxIters ?? AGENT_MAX_ITERS;

  for (let i = 0; i < maxIters; i++) {
    if (Date.now() - started > AGENT_TIMEOUT_MS) break;
    const last = i === maxIters - 1;
    const res = await callMessages(env, cfg.transport, cfg.system, convo, last ? [] : cfg.tools);
    convo.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b: any) => b?.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = res.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
      return { answer: text, trace };
    }

    const results: any[] = [];
    for (const tu of toolUses) {
      let result: unknown;
      try {
        result = await executeCopilotTool(toolCtx, tu.name, tu.input ?? {});
      } catch (e: any) {
        result = { error: String(e?.message ?? e) };
      }
      trace.push({ tool: tu.name, input: tu.input });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    convo.push({ role: "user", content: results });
  }

  // Ran out of iterations — one final, tool-free answer from what we gathered.
  const res = await callMessages(env, cfg.transport, cfg.system + "\n\nYou have gathered enough data. Give your final answer now using only figures already returned by the tools.", convo, []);
  const text = res.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
  return { answer: text, trace };
}

/**
 * Introspection helper. Runs one raw model call (with tools) plus a full agent
 * loop and reports the shapes/errors — so we can see why the agentic path may be
 * degrading without access to gateway/Worker logs. Triggered via the "/diag"
 * question. Contains no secrets.
 */
export async function copilotDiag(env: Env, db: DB, householdId: number): Promise<Record<string, unknown>> {
  const provider = (env.HFOS_COPILOT_PROVIDER ?? "rules").toLowerCase();
  const transport = pickTransport(env, provider);
  const out: Record<string, unknown> = { provider, transport: transport?.kind ?? null, model: (transport as any)?.model ?? null, has_AI_binding: !!(env as any).AI, gateway_id: env.HFOS_AI_GATEWAY_ID ?? null };
  if (!transport) { out.note = "No capable transport — need the AI binding (ai-gateway) or ANTHROPIC_API_KEY."; return out; }

  // Step 1 — one raw round trip with tools, to inspect the response shape.
  try {
    const body: any = { max_tokens: 300, system: "Test. Call the list_periods tool.", messages: [{ role: "user", content: "List the budget periods." }], tools: COPILOT_TOOLS };
    let raw: any;
    if (transport.kind === "ai-gateway") {
      raw = await withTimeout((env as any).AI.run(transport.model, body, { gateway: { id: transport.gatewayId } }), AGENT_CALL_TIMEOUT_MS);
    } else {
      const res = await withTimeout(fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": (env as any).ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: transport.model, ...body }) }), AGENT_CALL_TIMEOUT_MS);
      out.http_status = res.status;
      raw = await res.json();
    }
    out.raw_top_keys = raw && typeof raw === "object" ? Object.keys(raw) : typeof raw;
    out.raw_stop_reason = raw?.stop_reason ?? null;
    out.raw_content_types = Array.isArray(raw?.content) ? raw.content.map((b: any) => b?.type) : null;
    out.raw_snippet = JSON.stringify(raw).slice(0, 1400);
  } catch (e: any) {
    out.step1_error = String(e?.message ?? e);
  }

  // Step 2 — full agent loop, to see whether it produces a grounded answer.
  try {
    const r = await runAgent(env, db, householdId, { system: AGENT_SYSTEM, messages: [{ role: "user", content: "How many budget periods do we have? Use a tool to check." }], tools: COPILOT_TOOLS as unknown as any[], transport });
    out.agent_answer_len = r.answer.length;
    out.agent_answer_preview = r.answer.slice(0, 300);
    out.agent_tools_used = r.trace.map((t) => t.tool);
  } catch (e: any) {
    out.step2_error = String(e?.message ?? e);
  }
  return out;
}

/** Pick the capable transport for agentic reasoning (needs Claude — the free model can't tool-use). */
export function pickTransport(env: Env, provider: string): Transport | null {
  const hasAI = !!(env as any).AI;
  const hasKey = !!(env as any).ANTHROPIC_API_KEY;
  const model = env.HFOS_COPILOT_MODEL;
  const gatewayId = env.HFOS_AI_GATEWAY_ID || DEFAULT_AI_GATEWAY_ID;
  if ((provider === "auto" || provider === "ai-gateway") && hasAI) return { kind: "ai-gateway", model: model || DEFAULT_AI_GATEWAY_MODEL, gatewayId };
  if ((provider === "anthropic" || provider === "auto") && hasKey) return { kind: "anthropic", model: model || DEFAULT_ANTHROPIC_MODEL };
  return null;
}

// ── Conversation memory ───────────────────────────────────────────────────────
const HISTORY_TURNS = 10;

/** Load the last N turns for a session, oldest first, as agent messages. */
export async function loadHistory(db: DB, sessionKey: string, limit = HISTORY_TURNS): Promise<ConvMessage[]> {
  const rows = await db.select().from(copilotMessages)
    .where(eq(copilotMessages.session_key, sessionKey))
    .orderBy(desc(copilotMessages.id)).limit(limit * 2);
  return rows.reverse().map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", content: r.content }));
}

export async function saveTurn(db: DB, householdId: number, sessionKey: string, role: "user" | "assistant", content: string): Promise<void> {
  await db.insert(copilotMessages).values({ household_id: householdId, session_key: sessionKey, role, content: content.slice(0, 8000) });
}

/** Best-effort prune so a session's history stays bounded (delete oldest beyond `keep`). */
export async function pruneHistory(db: DB, sessionKey: string, keep = HISTORY_TURNS * 2): Promise<void> {
  const newest = await db.select({ id: copilotMessages.id }).from(copilotMessages)
    .where(eq(copilotMessages.session_key, sessionKey)).orderBy(desc(copilotMessages.id)).limit(keep + 1);
  if (newest.length <= keep) return;
  const cutoffId = newest[keep].id; // the (keep+1)-th newest and everything older goes
  await db.delete(copilotMessages).where(and(eq(copilotMessages.session_key, sessionKey), lte(copilotMessages.id, cutoffId)));
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
export async function copilotAnswer(
  env: Env,
  db: DB,
  householdId: number,
  question: string,
  periodId: number | null,
  history: ConvMessage[] = [],
) {
  // Hidden diagnostic: type "/diag" in the copilot to see why the agentic path
  // may be degrading (transport, raw response shape, and any error).
  if (question.trim().toLowerCase() === "/diag") {
    const diag = await copilotDiag(env, db, householdId).catch((e: any) => ({ error: String(e?.message ?? e) }));
    return { answer: "```json\n" + JSON.stringify(diag, null, 2) + "\n```", provider: "diag", matched_intent: "diag", grounded: false, citations: [] };
  }

  const rule = await answerQuestion(db, householdId, question, periodId);
  const provider = (env.HFOS_COPILOT_PROVIDER ?? "rules").toLowerCase();
  if (provider === "rules") return rule;

  // 1) Agentic path (primary): Claude drives read-only tools over ALL the data.
  //    Needs a capable transport — the free native model can't tool-use reliably.
  const transport = pickTransport(env, provider);
  if (transport) {
    try {
      const messages: ConvMessage[] = [...history, { role: "user", content: question }];
      const { answer, trace } = await runAgent(env, db, householdId, {
        system: AGENT_SYSTEM,
        messages,
        tools: COPILOT_TOOLS as unknown as any[],
        transport,
      });
      if (answer) {
        return { answer, citations: trace, matched_intent: rule.matched_intent, provider: transport.kind, grounded: true };
      }
    } catch {
      // fall through to the simple single-shot phrasing / rules
    }
  }

  // 2) Fallback: single-shot phrasing of the current-period facts (never worse than rules).
  const hasAI = !!(env as any).AI;
  const hasKey = !!(env as any).ANTHROPIC_API_KEY;
  const model = env.HFOS_COPILOT_MODEL;
  const gatewayId = env.HFOS_AI_GATEWAY_ID || DEFAULT_AI_GATEWAY_ID;
  if (periodId != null) {
    const attempts: CopilotAttempt[] = [];
    if (hasAI) attempts.push({ name: "workers-ai", run: (f) => runWorkersAI(env, DEFAULT_WORKERS_AI_MODEL, f, question) });
    if (hasAI) attempts.push({ name: "ai-gateway", run: (f) => runAiGateway(env, model || DEFAULT_AI_GATEWAY_MODEL, gatewayId, f, question) });
    if (hasKey) attempts.push({ name: "anthropic", run: (f) => runAnthropic(env, model || DEFAULT_ANTHROPIC_MODEL, f, question) });
    if (attempts.length) {
      let facts: unknown;
      try {
        facts = await buildFacts(db, householdId, periodId);
        for (const attempt of attempts) {
          try {
            const answer = await attempt.run(facts);
            return { answer, citations: [{ source: "calculation_engine", period_id: periodId, facts }], matched_intent: rule.matched_intent, provider: attempt.name, grounded: true };
          } catch { /* next */ }
        }
      } catch { /* fall through to rules */ }
    }
  }

  return { ...rule, provider: "rules", degraded: true };
}
