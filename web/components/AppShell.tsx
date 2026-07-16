"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { AUTH, getHouseholdId, getToken, logout, setHouseholdId } from "@/lib/api";
import type { Household } from "@/lib/types";
import { ThemeControls } from "@/components/theme";

// Primary navigation (information architecture §5.1).
const NAV = [
  { href: "/dashboard", label: "Home", icon: "◧" },
  { href: "/planner", label: "Budget", icon: "▤" },
  { href: "/cash-flow", label: "Cash flow", icon: "≈" },
  { href: "/payments", label: "Payments", icon: "✔" },
  { href: "/wealth", label: "Wealth", icon: "◆" },
  { href: "/property", label: "Property", icon: "⌂" },
  { href: "/goals", label: "Goals", icon: "◎" },
  { href: "/scenarios", label: "Scenarios", icon: "⟿" },
  { href: "/copilot", label: "Insights", icon: "✦" },
  { href: "/import", label: "Import", icon: "⇪" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];
// Priority items for the mobile bottom bar (§5.3, §6.3).
const MOBILE_NAV = ["/dashboard", "/planner", "/payments", "/wealth", "/copilot"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHh, setActiveHh] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    AUTH.me()
      .then((r) => {
        setHouseholds(r.households);
        const stored = getHouseholdId();
        setActiveHh(stored ? Number(stored) : r.households[0]?.id ?? null);
        setReady(true);
      })
      .catch(() => { logout(); router.replace("/login"); });
  }, [router]);

  function signOut() { logout(); router.replace("/login"); }
  function switchHousehold(id: number) {
    setActiveHh(id);
    setHouseholdId(id);
    router.refresh();
    if (typeof window !== "undefined") window.location.reload();
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-ink-muted">Loading…</div>
    );
  }

  const active = households.find((h) => h.id === activeHh) ?? households[0];

  return (
    <div className="flex min-h-screen bg-surface text-ink">
      <a href="#main" className="skip-link">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-card md:flex">
        <div className="px-5 py-5">
          <span className="inline-block rounded-lg bg-[#ffffff] p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-full.png" alt="HFOS — Household Financial OS" className="block h-auto w-40" />
          </span>
        </div>
        <nav aria-label="Primary" className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-brand-light text-brand-dark" : "text-ink-soft hover:bg-muted"
                }`}>
                <span className="text-base" aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line-soft px-5 py-4">
          <div className="text-xs font-medium text-ink">{active?.name}</div>
          <div className="text-xs text-ink-muted">{active?.base_currency} · {active?.role}</div>
          <button onClick={signOut} className="mt-2 text-xs text-ink-muted underline hover:text-negative">Sign out</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop command bar (§6.1) */}
        <header className="hidden items-center justify-between border-b border-line bg-card px-6 py-2.5 md:flex">
          <div>
            {households.length > 1 ? (
              <select value={activeHh ?? ""} onChange={(e) => switchHousehold(Number(e.target.value))} aria-label="Active household"
                className="rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink">
                {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            ) : (
              <span className="text-sm font-medium text-ink">{active?.name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/copilot" className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-muted">
              <span aria-hidden className="text-ai">✦</span> Ask HFOS
            </Link>
            <Link href="/planner" title="Quick create" aria-label="Quick create"
              className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-soft hover:bg-muted">＋</Link>
            <ThemeControls />
          </div>
        </header>

        {/* Mobile header */}
        <header className="flex items-center justify-between border-b border-line bg-card px-4 py-3 md:hidden">
          <span className="inline-block rounded-md bg-[#ffffff] p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-full.png" alt="HFOS" className="block h-6 w-auto" />
          </span>
          <div className="flex items-center gap-2">
            <ThemeControls />
            <button onClick={signOut} className="text-xs text-ink-muted underline">Sign out</button>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 outline-none md:px-6 md:py-8 md:pb-8">{children}</main>
      </div>

      {/* Floating copilot launcher (desktop) */}
      <Link href="/copilot" title="Ask HFOS" aria-label="Ask HFOS copilot"
        className="fixed bottom-6 right-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full bg-ai text-white shadow-card hover:opacity-90 md:flex">
        <span aria-hidden className="text-lg">✦</span>
      </Link>

      {/* Mobile bottom navigation (§6.3) */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card md:hidden">
        {NAV.filter((n) => MOBILE_NAV.includes(n.href)).map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-brand-dark" : "text-ink-muted"}`}>
              <span className="text-base" aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
