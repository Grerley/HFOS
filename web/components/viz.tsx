"use client";
import React from "react";

// Lightweight, dependency-free SVG/CSS visualisations. Kept minimal and
// self-contained so the app installs and builds cleanly.

export function ProgressBar({ value, tone = "brand" }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = tone === "positive" ? "bg-positive" : tone === "negative" ? "bg-negative" : "bg-brand";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CategoryBars({
  rows,
  format,
}: {
  rows: { category_name: string | null; amount_cents: number; pct_of_expenses: number }[];
  format: (cents: number) => string;
}) {
  if (!rows.length) return <p className="text-sm text-ink-muted">No expense categories yet.</p>;
  const max = Math.max(...rows.map((r) => r.amount_cents), 1);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-ink-soft">{r.category_name || "Uncategorised"}</span>
            <span className="tabular text-ink-muted">
              {format(r.amount_cents)} · {(r.pct_of_expenses * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-brand" style={{ width: `${(r.amount_cents / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({
  series,
}: {
  series: { label: string; income_cents: number; expenses_cents: number; net_cents: number }[];
}) {
  if (series.length < 2) {
    return <p className="text-sm text-ink-muted">Add more periods to see trends.</p>;
  }
  const w = 640;
  const h = 180;
  const pad = 24;
  const all = series.flatMap((s) => [s.income_cents, s.expenses_cents]);
  const max = Math.max(...all, 1);
  const min = Math.min(...series.map((s) => s.net_cents), 0);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (series.length - 1);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const line = (key: "income_cents" | "expenses_cents" | "net_cents") =>
    series.map((s, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(s[key])}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={line("income_cents")} fill="none" stroke="#047857" strokeWidth={2} />
      <path d={line("expenses_cents")} fill="none" stroke="#b91c1c" strokeWidth={2} />
      <path d={line("net_cents")} fill="none" stroke="#0e7490" strokeWidth={2} strokeDasharray="4 3" />
      {series.map((s, i) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor="middle" className="fill-current text-ink-muted text-[9px]">
          {s.label.length > 7 ? s.label.slice(0, 7) : s.label}
        </text>
      ))}
    </svg>
  );
}
