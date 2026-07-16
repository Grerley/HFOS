"use client";
import { useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      setAnalysis(await api.upload<any>("/import/workbook/analyze", form));
      setReport(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      setReport(await api.upload<any>("/import/workbook", form));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Import workbook"
        description="Bring your existing Excel budget in. Import is idempotent — re-running never duplicates periods."
      />

      <Card className="mb-6" title="1 · Choose file">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setAnalysis(null); setReport(null); }}
          className="block text-sm"
        />
        <div className="mt-4 flex gap-2">
          <Button variant="ghost" onClick={analyze} disabled={!file || busy}>Analyze</Button>
          <Button onClick={runImport} disabled={!file || busy}>{busy ? "Working…" : "Import"}</Button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          A synthetic sample workbook is generated at <code>backend/data/sample_workbook.xlsx</code> for testing.
        </p>
      </Card>

      {analysis && (
        <Card className="mb-6" title="2 · Preview" subtitle={`Detected owners: ${analysis.detected_owners.join(", ") || "none"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-ink-muted">
                <th className="py-1">Sheet</th><th className="py-1">Type</th><th className="py-1">Owners</th><th className="py-1 text-right">Lines</th>
              </tr>
            </thead>
            <tbody>
              {analysis.sheets.map((s: any, i: number) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="py-1.5">{s.sheet}</td>
                  <td className="py-1.5"><Badge tone={s.kind === "monthly" ? "positive" : "neutral"}>{s.kind}</Badge></td>
                  <td className="py-1.5 text-xs text-ink-muted">{(s.owners || []).join(", ")}</td>
                  <td className="py-1.5 text-right tabular">{s.line_count ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {report && (
        <Card title="3 · Reconciliation report">
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Periods imported" value={report.periods_imported} />
            <Tile label="Periods skipped" value={report.periods_skipped} />
            <Tile label="Lines imported" value={report.lines_imported} />
            <Tile label="Review items" value={report.review_queue.length} />
          </div>
          {report.reconciliation.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink-muted">
                  <th className="py-1">Sheet</th><th className="py-1 text-right">Income (wb → imported)</th><th className="py-1 text-right">Expenses (wb → imported)</th>
                </tr>
              </thead>
              <tbody>
                {report.reconciliation.map((r: any, i: number) => {
                  const incOk = r.workbook_total_income_cents === r.imported_total_income_cents;
                  const expOk = r.workbook_total_expenses_cents === r.imported_total_expenses_cents;
                  return (
                    <tr key={i} className="border-t border-line-soft tabular">
                      <td className="py-1.5">{r.sheet}</td>
                      <td className={`py-1.5 text-right ${incOk ? "text-positive" : "text-negative"}`}>
                        {formatMoney(r.workbook_total_income_cents)} → {formatMoney(r.imported_total_income_cents)} {incOk ? "✓" : "✕"}
                      </td>
                      <td className={`py-1.5 text-right ${expOk ? "text-positive" : "text-negative"}`}>
                        {formatMoney(r.workbook_total_expenses_cents)} → {formatMoney(r.imported_total_expenses_cents)} {expOk ? "✓" : "✕"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {report.review_queue.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-ink">Review queue</p>
              {report.review_queue.map((q: any, i: number) => (
                <div key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {q.sheet}: {q.reason} — {q.action}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {!analysis && !report && <EmptyState title="No file analysed yet" hint="Choose an .xlsx workbook and click Analyze." />}
    </AppShell>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="tabular text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
