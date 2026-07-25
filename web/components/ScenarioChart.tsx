"use client";
import { useMemo, useState } from "react";

export interface ChartSeries {
  label: string;
  color: string;
  values: number[];   // one value per month (index 0 = month 1)
  dashed?: boolean;
}

/**
 * Lightweight, dependency-free multi-series line chart (net worth over time).
 * Renders as responsive inline SVG; hover shows the values at a month.
 */
export default function ScenarioChart({
  series,
  months,
  format,
  height = 240,
}: {
  series: ChartSeries[];
  months: number;
  format: (cents: number) => string;
  height?: number;
}) {
  const W = 720, H = height, padL = 8, padR = 8, padT = 12, padB = 22;
  const [hover, setHover] = useState<number | null>(null);

  const { min, max } = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (const s of series) for (const v of s.values) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!Number.isFinite(mn)) { mn = 0; mx = 0; }
    if (mn === mx) { mn -= 1; mx += 1; }
    // Always show the zero line if the range straddles it.
    if (mn > 0) mn = 0;
    return { min: mn, max: mx };
  }, [series]);

  const n = Math.max(1, months);
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const zeroY = y(0);

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const yearTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let m = 12; m <= n; m += 12) ticks.push(m);
    if (!ticks.length) ticks.push(n);
    return ticks;
  }, [n]);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Net worth projection over time"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {/* zero baseline */}
        {min < 0 && (
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity={0.18} strokeDasharray="3 3" />
        )}
        {/* year gridlines */}
        {yearTicks.map((m) => (
          <g key={m}>
            <line x1={x(m - 1)} x2={x(m - 1)} y1={padT} y2={H - padB} stroke="currentColor" strokeOpacity={0.07} />
            <text x={x(m - 1)} y={H - 6} textAnchor="middle" className="fill-current" fontSize="10" opacity={0.5}>
              {m % 12 === 0 ? `${m / 12}y` : `${m}m`}
            </text>
          </g>
        ))}
        {/* series */}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2}
            strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
        {/* hover marker */}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="currentColor" strokeOpacity={0.25} />
            {series.map((s) => (
              <circle key={s.label} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={3.5} fill={s.color} />
            ))}
          </g>
        )}
      </svg>

      {/* legend + hover readout */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-ink-soft">
            <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
            {s.label}
            {hover != null && <span className="tabular font-medium text-ink"> · {format(s.values[hover] ?? 0)}</span>}
          </span>
        ))}
        <span className="ml-auto text-ink-muted">
          {hover != null ? `Month ${hover + 1}${(hover + 1) % 12 === 0 ? ` (${(hover + 1) / 12}y)` : ""}` : "Hover for detail"}
        </span>
      </div>
    </div>
  );
}
