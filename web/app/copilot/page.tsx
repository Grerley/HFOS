"use client";
import { useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Input, Badge } from "@/components/ui";
import { api } from "@/lib/api";

interface Turn { q: string; a: string; intent: string; provider: string; citations: any[]; }

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
      setTurns((t) => [{ q: question, a: res.answer, intent: res.matched_intent, provider: res.provider, citations: res.citations }, ...t]);
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
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="info">intent: {t.intent}</Badge>
              <Badge>provider: {t.provider}</Badge>
              {t.citations.length > 0 && <Badge tone="positive">grounded in calc engine</Badge>}
            </div>
          </Card>
        ))}
        {!turns.length && (
          <p className="text-sm text-ink-muted">
            The first release uses an explainable rule-based engine. The architecture leaves a typed
            provider seam for a future LLM, which would still call the deterministic calculation tools
            for any number.
          </p>
        )}
      </div>
    </AppShell>
  );
}
