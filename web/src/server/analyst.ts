/**
 * Proactive insight analyst. Runs the same agentic loop, but in "find what the
 * household hasn't noticed" mode: it investigates across history with the
 * read-only tools and records the most important findings as Insight rows for
 * the user to review (dashboard) and optionally receive over Telegram.
 *
 * Insights it records are tagged `ai:<slug>`; each run refreshes that set so the
 * dashboard shows the current picture rather than accumulating duplicates.
 */
import { and, desc, eq, like } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { budgetPeriods, insights } from "../db/schema";
import { AGENT_SYSTEM, pickTransport, runAgent, type ConvMessage } from "./copilot";
import { COPILOT_TOOLS, RECORD_INSIGHT_TOOL, type InsightFinding } from "./copilotTools";

const ANALYST_SYSTEM =
  AGENT_SYSTEM +
  `

PROACTIVE ANALYST MODE. Investigate this household's finances across history using the tools (trends, comparisons, goals, properties, payments, net worth). Identify up to 5 of the MOST important things the household likely has NOT noticed: emerging trends, drift, concentration risk, goals slipping, cash-flow risk, and opportunities. Call record_insight ONCE per distinct finding, quoting the specific figures you found. Prioritise signal over noise. Skip the obvious and anything trivial. When done, reply with a one-line summary of what you recorded.`;

export async function runInsightAnalyst(env: Env, db: DB, householdId: number): Promise<{ recorded: number; summaries: string[] }> {
  const provider = (env.HFOS_COPILOT_PROVIDER ?? "rules").toLowerCase();
  const transport = pickTransport(env, provider);
  if (!transport) return { recorded: 0, summaries: [] };

  const latest = (await db.select().from(budgetPeriods).where(eq(budgetPeriods.household_id, householdId)).orderBy(desc(budgetPeriods.start_date)).limit(1)).at(0);

  const collected: InsightFinding[] = [];
  const onInsight = async (f: InsightFinding) => { if (collected.length < 8) collected.push(f); };

  const messages: ConvMessage[] = [{ role: "user", content: "Run your proactive review now and record the most important findings." }];
  try {
    await runAgent(env, db, householdId, {
      system: ANALYST_SYSTEM,
      messages,
      tools: [...COPILOT_TOOLS, RECORD_INSIGHT_TOOL] as unknown as any[],
      transport,
      onInsight,
      maxIters: 12,
    });
  } catch {
    return { recorded: 0, summaries: [] };
  }

  if (!collected.length) return { recorded: 0, summaries: [] };

  // Refresh the AI-generated set: clear prior open ones, insert the new findings.
  await db.delete(insights).where(and(eq(insights.household_id, householdId), like(insights.type, "ai:%"), eq(insights.status, "open")));
  for (const f of collected) {
    await db.insert(insights).values({
      household_id: householdId,
      period_id: latest?.id ?? null,
      type: `ai:${f.type}`.slice(0, 64),
      severity: f.severity,
      summary: f.summary,
      explanation: f.explanation,
      action: f.action ?? null,
      evidence_json: (f.evidence ?? {}) as Record<string, unknown>,
    });
  }
  return { recorded: collected.length, summaries: collected.map((f) => f.summary) };
}
