"use client";
import { useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Input, Badge } from "@/components/ui";
import { api } from "@/lib/api";

interface Turn { q: string; a: string; intent: string; provider: string; citations: any[]; degraded?: boolean; }

const PROVIDER_LABEL: Record<string, string> = {
  "workers-ai": "Workers AI",
  anthropic: "Claude",
  rules: "rule engine",
};

const SUGGESTIONS = [
  "Can we afford this decision?",
  "What changed this month?",
  "Why are we over budget?",
  "Are we on track for our savings goals?",
  "Which property is underperforming?",
  "What should we do with a bonus?",
];

export default function CopilotPage() {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<any>("/copilot/ask", { question });
      setTurns((t) => [{ q: question, a: res.answer, intent: res.matched_intent, provider: res.provider, citations: res.citations ?? [], degraded: res.degraded }, ...t]);
      setQ("");
    } catch (e: any) {
      setTurns((t) => [{ q: question, a: "Error: " + e.message, intent: "error", provider: "rules", citations: [] }, ...t]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Copilot" description="Explainable answers grounded in your household data. Every figure is computed server-side." />

      <Card className="mb-6">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your budget, savings, property…" />
          <Button type="submit" disabled={busy}>{busy ? "Thinking…" : "Ask"}</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:bg-muted">
              {s}
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        {turns.map((t, i) => (
          <Card key={i}>
            <p className="text-sm font-semibold text-ink">{t.q}</p>
            <p className="mt-2 text-sm text-ink-soft">{t.a}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="info">{PROVIDER_LABEL[t.provider] ?? t.provider}</Badge>
              {t.citations.length > 0 && <Badge tone="positive">grounded in calc engine</Badge>}
              {t.degraded && <Badge tone="warning">AI unavailable — rule engine</Badge>}
            </div>
          </Card>
        ))}
        {!turns.length && (
          <p className="text-sm text-ink-muted">
            Ask in plain language. The copilot phrases its answer with an LLM (Cloudflare Workers AI by
            default), but every figure it quotes is computed by the deterministic calculation engine and
            passed in as grounded facts — the model never does the maths. If the model is unavailable, it
            falls back to the explainable rule engine automatically.
          </p>
        )}
      </div>
    </AppShell>
  );
}
