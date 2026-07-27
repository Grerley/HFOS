"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { AUTH, getHouseholdId, getToken, logout, setHouseholdId } from "@/lib/api";
import type { Household } from "@/lib/types";
import { ThemeControls } from "@/components/theme";
import OfflineBanner from "@/components/OfflineBanner";
import { CurrencyContext } from "@/lib/currency";
import { SETTINGS_TABS } from "@/lib/settingsTabs";
import Logo from "@/components/Logo";

type NavLeaf = { href: string; label: string; icon: string };
type NavGroup = { id: string; label: string; icon: string; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

// Primary navigation (information architecture §5.1). Some entries are
// collapsible groups whose children are related sub-sections.
const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Home", icon: "◧" },
  { href: "/planner", label: "Budget", icon: "▤" },
  { href: "/cash-flow", label: "Cash flow", icon: "≈" },
  { href: "/payments", label: "Payments", icon: "✔" },
  {
    id: "wealth", label: "Wealth & plans", icon: "◆", children: [
      { href: "/wealth", label: "Net worth", icon: "◆" },
      { href: "/property", label: "Property", icon: "⌂" },
      { href: "/goals", label: "Goals", icon: "◎" },
      { href: "/scenarios", label: "Scenarios", icon: "⟿" },
    ],
  },
  { href: "/copilot", label: "Insights", icon: "✦" },
  { href: "/import", label: "Import", icon: "⇪" },
  {
    id: "settings", label: "Settings", icon: "⚙",
    children: SETTINGS_TABS.map((t) => ({ href: `/settings?tab=${t.id}`, label: t.label, icon: "·" })),
  },
];
// Priority items for the mobile bottom bar (§5.3, §6.3).
const MOBILE_ITEMS: NavLeaf[] = [
  { href: "/dashboard", label: "Home", icon: "◧" },
  { href: "/planner", label: "Budget", icon: "▤" },
  { href: "/payments", label: "Payments", icon: "✔" },
  { href: "/wealth", label: "Wealth", icon: "◆" },
  { href: "/copilot", label: "Insights", icon: "✦" },
];

const basePath = (href: string) => href.split("?")[0];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHh, setActiveHh] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const groupActive = (g: NavGroup) => g.children.some((c) => pathname?.startsWith(basePath(c.href)));
  const leafActive = (href: string) => {
    const base = basePath(href);
    return href.includes("?") ? false : pathname?.startsWith(base); // query-scoped children aren't individually highlighted
  };

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
  const currency = active?.base_currency || "ZAR";

  return (
    <CurrencyContext.Provider value={currency}>
    <div className="flex min-h-screen bg-surface text-ink">
      <a href="#main" className="skip-link">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-card md:flex">
        <div className="px-5 py-5">
          <Link href="/dashboard" className="inline-flex" aria-label="HFOS home">
            <Logo size={40} />
          </Link>
        </div>
        <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3">
          {NAV.map((item) => {
            if (!isGroup(item)) {
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
            }
            const activeInGroup = groupActive(item);
            const open = openGroups[item.id] ?? activeInGroup;
            return (
              <div key={item.id}>
                <button
                  onClick={() => setOpenGroups((s) => ({ ...s, [item.id]: !open }))}
                  aria-expanded={open}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    activeInGroup ? "text-brand-dark" : "text-ink-soft hover:bg-muted"
                  }`}>
                  <span className="text-base" aria-hidden>{item.icon}</span>
                  <span className="flex-1 text-left">{item.label}</span>
                  <span aria-hidden className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                </button>
                {open && (
                  <div className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-line-soft pl-2">
                    {item.children.map((c) => {
                      const active = leafActive(c.href);
                      return (
                        <Link key={c.href} href={c.href} aria-current={active ? "page" : undefined}
                          className={`block rounded-lg px-3 py-1.5 text-sm transition ${
                            active ? "bg-brand-light font-medium text-brand-dark" : "text-ink-soft hover:bg-muted"
                          }`}>
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
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
        <OfflineBanner />
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
          <Link href="/dashboard" className="inline-flex" aria-label="HFOS home">
            <Logo size={28} />
          </Link>
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
        {MOBILE_ITEMS.map((item) => {
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
    </CurrencyContext.Provider>
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
