"use client";
import React from "react";

export function Card({
  children,
  className = "",
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-line bg-card shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "positive" | "negative";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  const interactive = onClick
    ? "cursor-pointer text-left transition hover:border-brand hover:shadow-card focus:outline-none focus:ring-2 focus:ring-brand"
    : "";
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`w-full rounded-xl border border-line bg-card p-5 shadow-sm ${interactive}`}>
      <p className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}{onClick && <span aria-hidden className="text-ink-muted">›</span>}
      </p>
      <p className={`tabular mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Tag>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-brand text-brand-fg hover:opacity-90",
    ghost: "bg-card text-ink border border-line hover:bg-muted",
    danger: "bg-negative text-white hover:opacity-90",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const map: Record<string, string> = {
    neutral: "bg-muted text-ink",
    info: "bg-cyan-50 text-cyan-700",
    warning: "bg-amber-50 text-amber-700",
    critical: "bg-red-50 text-red-700",
    opportunity: "bg-emerald-50 text-emerald-700",
    positive: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${map[tone] || map.neutral}`}>
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand ${props.className || ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand ${props.className || ""}`}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-card p-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-10 text-sm text-ink-muted">Loading…</div>
  );
}

// ── Drawer (right slide-over for drill-downs & detail, §6.1) ───────────────────
export function Drawer({ open, onClose, title, subtitle, children }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-card shadow-card">
        <div className="flex items-start justify-between border-b border-line-soft px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-ink-muted hover:bg-muted">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Modal (centered dialog for wizards & forms) ────────────────────────────────
export function Modal({ open, onClose, title, subtitle, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative my-8 w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl border border-line bg-card shadow-card`}>
        <div className="flex items-start justify-between border-b border-line-soft px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-ink-muted hover:bg-muted">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Compact stepper header for multi-step wizards. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
            i < current ? "bg-brand text-brand-fg" : i === current ? "bg-brand-light text-brand-dark ring-1 ring-brand" : "bg-muted text-ink-muted"
          }`}>{i < current ? "✓" : i + 1}</span>
          <span className={i === current ? "font-medium text-ink" : "text-ink-muted"}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 text-ink-muted">›</span>}
        </li>
      ))}
    </ol>
  );
}

/** A single "amount = calculation" row used inside drill-down drawers. */
export function DrillRow({ label, value, tone, strong }: { label: string; value: string; tone?: "positive" | "negative"; strong?: boolean }) {
  const c = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className={`flex items-center justify-between py-1.5 ${strong ? "border-t border-line-soft font-semibold" : ""}`}>
      <span className={`text-sm ${strong ? "text-ink" : "text-ink-soft"}`}>{label}</span>
      <span className={`tabular text-sm ${strong ? "font-semibold" : ""} ${c}`}>{value}</span>
    </div>
  );
}

// ── Skeleton loaders (§20.1: preserve layout, no full-screen spinners) ─────────
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function MetricSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-28" />
    </div>
  );
}

/** Dashboard/page skeleton that preserves layout while data loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <MetricSkeleton key={i} />)}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5"><Skeleton className="h-40 w-full" /></div>
        <div className="rounded-xl border border-line bg-card p-5"><Skeleton className="h-40 w-full" /></div>
      </div>
    </div>
  );
}
