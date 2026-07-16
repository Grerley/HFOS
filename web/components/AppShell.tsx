"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { AUTH, getToken, logout } from "@/lib/api";
import type { Household } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "◧" },
  { href: "/planner", label: "Monthly planner", icon: "▤" },
  { href: "/payments", label: "Payments", icon: "✔" },
  { href: "/wealth", label: "Wealth & savings", icon: "◆" },
  { href: "/property", label: "Property", icon: "⌂" },
  { href: "/goals", label: "Goals", icon: "◎" },
  { href: "/scenarios", label: "Scenarios", icon: "⟿" },
  { href: "/copilot", label: "Copilot", icon: "✦" },
  { href: "/import", label: "Import workbook", icon: "⇪" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [household, setHousehold] = useState<Household | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    AUTH.me()
      .then((r) => {
        setHousehold(r.households[0] ?? null);
        setReady(true);
      })
      .catch(() => {
        logout();
        router.replace("/login");
      });
  }, [router]);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.png" alt="HFOS — Household Financial OS" className="h-auto w-44" />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-brand-light text-brand-dark" : "text-ink-soft hover:bg-slate-50"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="text-xs font-medium text-ink">{household?.name}</div>
          <div className="text-xs text-ink-muted">{household?.base_currency} · {household?.role}</div>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="mt-2 text-xs text-ink-muted underline hover:text-negative"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 md:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.png" alt="HFOS" className="h-7 w-auto" />
          <button onClick={() => { logout(); router.replace("/login"); }} className="text-xs underline">
            Sign out
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
