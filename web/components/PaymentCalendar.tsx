"use client";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";

export interface CalendarLine {
  line_id: number;
  item_name: string;
  due_date: string | null;
  outstanding_cents: number;
  planned_cents: number;
  status: string;
  is_overdue: boolean;
}

const STATUS_DOT: Record<string, string> = {
  not_paid: "bg-ink-muted",
  scheduled: "bg-info",
  partially_paid: "bg-warning",
  fully_paid: "bg-positive",
  overpaid: "bg-brand",
  overdue: "bg-negative",
  cancelled: "bg-ink-muted",
  not_applicable: "bg-ink-muted",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Parse an ISO date to a stable local Y/M/D key without timezone drift.
function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}
function monthKey(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}
function dayKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}
// Weekday index Mon=0..Sun=6 for the 1st of the month (no Date tz surprises for local).
function firstWeekdayMonday(y: number, m: number) {
  const js = new Date(y, m, 1).getDay(); // 0=Sun..6=Sat
  return (js + 6) % 7;
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function PaymentCalendar({
  lines,
  today,
  currency,
  selected,
  onToggleSelect,
  onPay,
}: {
  lines: CalendarLine[];
  today: string;
  currency: string;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onPay: (lineId: number) => void;
}) {
  const money = (c: number) => formatMoney(c, currency);
  const dated = lines.filter((l) => l.due_date);
  const undated = lines.filter((l) => !l.due_date);

  // Start on the month with the most obligations, else today's month.
  const initial = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of dated) {
      const { y, m } = parseISO(l.due_date!);
      counts.set(monthKey(y, m), (counts.get(monthKey(y, m)) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    if (best) { const [y, m] = best.split("-").map(Number); return { y, m: m - 1 }; }
    const t = parseISO(today);
    return { y: t.y, m: t.m };
  }, [dated, today]);

  const [ym, setYm] = useState(initial);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarLine[]>();
    for (const l of dated) {
      const { y, m, d } = parseISO(l.due_date!);
      if (y !== ym.y || m !== ym.m) continue;
      const key = dayKey(y, m, d);
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return map;
  }, [dated, ym]);

  function shift(delta: number) {
    setYm((cur) => {
      const m = cur.m + delta;
      const y = cur.y + Math.floor(m / 12);
      return { y, m: ((m % 12) + 12) % 12 };
    });
  }

  const total = daysInMonth(ym.y, ym.m);
  const lead = firstWeekdayMonday(ym.y, ym.m);
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthOutstanding = dated
    .filter((l) => { const { y, m } = parseISO(l.due_date!); return y === ym.y && m === ym.m; })
    .reduce((s, l) => s + l.outstanding_cents, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} aria-label="Previous month" className="rounded-lg border border-line px-2 py-1 text-ink-soft hover:bg-muted">‹</button>
          <span className="text-sm font-semibold text-ink">{MONTH_NAMES[ym.m]} {ym.y}</span>
          <button onClick={() => shift(1)} aria-label="Next month" className="rounded-lg border border-line px-2 py-1 text-ink-soft hover:bg-muted">›</button>
        </div>
        <span className="text-xs text-ink-muted">Outstanding this month: <span className="tabular font-medium text-negative">{money(monthOutstanding)}</span></span>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-card px-2 py-1.5 text-center text-[11px] font-medium uppercase text-ink-muted">{w}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="min-h-[84px] bg-surface" />;
          const key = dayKey(ym.y, ym.m, day);
          const items = byDay.get(key) ?? [];
          const isToday = key === today;
          const dayOutstanding = items.reduce((s, l) => s + l.outstanding_cents, 0);
          return (
            <div key={i} className="min-h-[84px] bg-card p-1.5">
              <div className="mb-1 flex items-center justify-between">
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${isToday ? "bg-brand text-brand-fg font-semibold" : "text-ink-muted"}`}>{day}</span>
                {dayOutstanding > 0 && <span className="tabular text-[10px] text-negative">{money(dayOutstanding)}</span>}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((l) => {
                  const sel = selected.has(l.line_id);
                  return (
                    <button
                      key={l.line_id}
                      onClick={() => (l.outstanding_cents > 0 ? onPay(l.line_id) : undefined)}
                      title={`${l.item_name} · ${money(l.outstanding_cents)} outstanding`}
                      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] ${sel ? "bg-brand-light" : "hover:bg-muted"}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[l.status] ?? "bg-ink-muted"}`} aria-hidden />
                      <span className="truncate text-ink-soft">{l.item_name}</span>
                    </button>
                  );
                })}
                {items.length > 3 && <div className="px-1 text-[10px] text-ink-muted">+{items.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-muted">
        <Legend cls="bg-ink-muted" label="Not paid" />
        <Legend cls="bg-warning" label="Partial" />
        <Legend cls="bg-positive" label="Paid" />
        <Legend cls="bg-negative" label="Overdue" />
        <Legend cls="bg-info" label="Scheduled" />
      </div>

      {undated.length > 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-card p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-ink-muted">No due date ({undated.length})</div>
          <div className="flex flex-wrap gap-2">
            {undated.map((l) => (
              <button key={l.line_id} onClick={() => (l.outstanding_cents > 0 ? onPay(l.line_id) : undefined)}
                className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink-soft hover:bg-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[l.status] ?? "bg-ink-muted"}`} aria-hidden />
                {l.item_name} · <span className="tabular">{money(l.outstanding_cents)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${cls}`} />{label}</span>;
}
