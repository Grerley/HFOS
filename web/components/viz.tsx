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

type TrendPoint = { label: string; income_cents: number; expenses_cents: number; net_cents: number };

/** Running-balance line with a zero baseline; dips below zero are flagged negative. */
export function BalanceChart({
  points,
  format,
}: {
  points: { label: string; balance_cents: number }[];
  format: (cents: number) => string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  if (points.length < 2) return <p className="text-sm text-ink-muted">Not enough data to plot a balance line.</p>;
  const w = 640;
  const h = 200;
  const pad = 28;
  const vals = points.map((p) => p.balance_cents);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const zeroY = y(0);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.balance_cents)}`).join(" ");
  const dipsNegative = min < 0;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Projected running cash balance"
        onMouseLeave={() => setHover(null)}>
        {/* Zero baseline */}
        <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} className="text-line" stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" />
        <text x={pad} y={zeroY - 3} className="fill-current text-ink-muted text-[9px]">0</text>
        <path d={path} fill="none" strokeWidth={2} className={dipsNegative ? "text-negative" : "text-brand"} stroke="currentColor" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            {hover === i && <line x1={x(i)} y1={pad / 2} x2={x(i)} y2={h - pad} className="text-line" stroke="currentColor" strokeWidth={1} />}
            <circle cx={x(i)} cy={y(p.balance_cents)} r={hover === i ? 3.5 : 0}
              className={p.balance_cents < 0 ? "text-negative" : "text-brand"} fill="currentColor" />
            <rect x={x(i) - (w - 2 * pad) / points.length / 2} y={0} width={(w - 2 * pad) / points.length} height={h} fill="transparent" />
            <title>{`${p.label}: ${format(p.balance_cents)}`}</title>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="mt-2 rounded-lg border border-line-soft bg-muted px-3 py-2 text-xs" role="status">
          <span className="font-medium text-ink">{points[hover].label}</span>
          <span className={`tabular ml-3 ${points[hover].balance_cents < 0 ? "text-negative" : "text-brand-dark"}`}>
            {format(points[hover].balance_cents)}
          </span>
        </div>
      )}
    </figure>
  );
}

export function TrendChart({
  series,
  format = (c: number) => String(c),
}: {
  series: TrendPoint[];
  format?: (cents: number) => string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [showTable, setShowTable] = React.useState(false);

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
  // Colours are token-driven: each series paints with `currentColor` set by a
  // Tailwind text-* class that resolves to the theme CSS variable (light/dark aware).
  const keys: { key: keyof TrendPoint; cls: string; dash?: string; name: string }[] = [
    { key: "income_cents", cls: "text-positive", name: "Income" },
    { key: "expenses_cents", cls: "text-negative", name: "Expenses" },
    { key: "net_cents", cls: "text-brand", dash: "4 3", name: "Net" },
  ];
  const line = (key: keyof TrendPoint) =>
    series.map((s, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(s[key] as number)}`).join(" ");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label="Trend of income, expenses and net across recent periods"
        onMouseLeave={() => setHover(null)}
      >
        {keys.map((k) => (
          <path key={k.key as string} d={line(k.key)} fill="none" strokeWidth={2} strokeDasharray={k.dash} className={k.cls} stroke="currentColor" />
        ))}
        {/* Hover markers + native tooltip per point (accessible + no dependency). */}
        {series.map((s, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            {hover === i && <line x1={x(i)} y1={pad / 2} x2={x(i)} y2={h - pad} className="text-line" stroke="currentColor" strokeWidth={1} />}
            {keys.map((k) => (
              <circle key={k.key as string} cx={x(i)} cy={y(s[k.key] as number)} r={hover === i ? 3.5 : 0} className={k.cls} fill="currentColor" />
            ))}
            {/* Invisible wide hit-area for easy hovering. */}
            <rect x={x(i) - (w - 2 * pad) / series.length / 2} y={0} width={(w - 2 * pad) / series.length} height={h} fill="transparent" />
            <title>{`${s.label} — Income ${format(s.income_cents)}, Expenses ${format(s.expenses_cents)}, Net ${format(s.net_cents)}`}</title>
          </g>
        ))}
        {series.map((s, i) => (
          <text key={`t${i}`} x={x(i)} y={h - 6} textAnchor="middle" className="fill-current text-ink-muted text-[9px]">
            {s.label.length > 7 ? s.label.slice(0, 7) : s.label}
          </text>
        ))}
      </svg>

      {hover !== null && (
        <div className="mt-2 rounded-lg border border-line-soft bg-muted px-3 py-2 text-xs" role="status">
          <span className="font-medium text-ink">{series[hover].label}</span>
          <span className="tabular ml-3 text-positive">In {format(series[hover].income_cents)}</span>
          <span className="tabular ml-3 text-negative">Out {format(series[hover].expenses_cents)}</span>
          <span className="tabular ml-3 text-brand-dark">Net {format(series[hover].net_cents)}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="mt-2 text-xs font-medium text-ink-muted underline hover:text-ink"
        aria-expanded={showTable}
      >
        {showTable ? "Hide data table" : "View as table"}
      </button>
      {showTable && (
        <figcaption className="sr-only">Underlying trend data</figcaption>
      )}
      <table className={`mt-2 w-full text-xs ${showTable ? "" : "sr-only"}`}>
        <thead>
          <tr className="text-left text-ink-muted">
            <th className="py-1 font-medium">Period</th>
            <th className="py-1 text-right font-medium">Income</th>
            <th className="py-1 text-right font-medium">Expenses</th>
            <th className="py-1 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => (
            <tr key={i} className="border-t border-line-soft">
              <td className="py-1 text-ink-soft">{s.label}</td>
              <td className="tabular py-1 text-right text-positive">{format(s.income_cents)}</td>
              <td className="tabular py-1 text-right text-negative">{format(s.expenses_cents)}</td>
              <td className="tabular py-1 text-right text-brand-dark">{format(s.net_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
