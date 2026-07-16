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
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-card p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`tabular mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
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
