"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, Badge, PageSkeleton, ErrorState } from "@/components/ui";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney, toCents } from "@/lib/format";
import type { Category, Member } from "@/lib/types";

interface Account { id: number; name: string; type: string; current_balance_cents: number; }

export default function SettingsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email_sent: boolean; invite_link: string | null } | null>(null);
  const currency = useCurrency();

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const [m, a, c] = await Promise.all([
        api.get<Member[]>("/members"),
        api.get<Account[]>("/accounts"),
        api.get<Category[]>("/categories"),
      ]);
      setMembers(m); setAccounts(a); setCategories(c);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      await api.post("/members", { name: f.get("name"), relationship_label: f.get("rel"), role: f.get("role") });
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err: any) { alert(err.message); }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      const res = await api.post<{ email_sent: boolean; invite_link: string | null }>("/members/invite", {
        name: f.get("name"), email: f.get("email"), role: f.get("role"),
      });
      (e.target as HTMLFormElement).reset();
      setInviteResult(res);
      await load();
    } catch (err: any) { alert(err.message); }
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      await api.post("/accounts", {
        name: f.get("name"), type: f.get("type"),
        current_balance_cents: toCents(f.get("balance") as string),
        balance_date: new Date().toISOString().slice(0, 10),
      });
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err: any) { alert(err.message); }
  }

  const sections = categories.filter((c) => c.is_section);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;
  if (error) return (
    <AppShell>
      <PageHeader title="Settings" description="Manage members, accounts and categories." />
      <ErrorState hint="We couldn't load your settings. Check your connection and try again." onRetry={load} />
    </AppShell>
  );

  return (
    <AppShell>
      <PageHeader title="Settings" description="Manage members, accounts and categories." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Household members">
          <div className="mb-4 space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg bg-muted px-4 py-2">
                <span className="text-sm">{m.name} <span className="text-xs text-ink-muted">· {m.relationship_label || "member"}</span></span>
                <div className="flex items-center gap-2">
                  {!m.user_id && <Badge tone="warning">pending</Badge>}
                  <Badge>{m.role}</Badge>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={addMember} className="grid grid-cols-3 gap-2">
            <Input name="name" placeholder="Name" required />
            <Input name="rel" placeholder="Relationship" />
            <Select name="role" defaultValue="partner">
              {["owner", "partner", "viewer", "advisor", "admin", "child"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <div className="col-span-3"><Button type="submit" variant="ghost">Add member</Button></div>
          </form>
        </Card>

        <Card title="Invite a partner (login access)">
          <form onSubmit={invite} className="grid grid-cols-2 gap-2">
            <Input name="name" placeholder="Name" required />
            <Input name="email" type="email" placeholder="Email" required />
            <Select name="role" defaultValue="partner">
              {["partner", "viewer", "advisor", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <div className="col-span-2"><Button type="submit" variant="ghost">Send invite</Button></div>
          </form>
          {inviteResult ? (
            inviteResult.email_sent ? (
              <p className="mt-2 rounded-lg bg-positive/10 px-3 py-2 text-xs text-positive">Invitation emailed. They'll set their own password via a secure link (expires in 7 days).</p>
            ) : (
              <div className="mt-2 rounded-lg bg-info/10 px-3 py-2 text-xs text-info">
                <p className="font-medium">Email isn't configured yet — share this secure invite link (expires in 7 days):</p>
                <div className="mt-1 flex items-center gap-2">
                  <input readOnly value={inviteResult.invite_link ?? ""} className="w-full rounded border border-line bg-card px-2 py-1 text-ink" onFocus={(e) => e.target.select()} />
                  <button type="button" onClick={() => inviteResult.invite_link && navigator.clipboard?.writeText(inviteResult.invite_link)} className="shrink-0 rounded border border-current px-2 py-1 font-medium">Copy</button>
                </div>
              </div>
            )
          ) : (
            <p className="mt-2 text-xs text-ink-muted">Sends a secure link; the invitee sets their own password. If email isn't configured, you'll get a link to share.</p>
          )}
        </Card>

        <Card title="Accounts">
          <div className="mb-4 space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-muted px-4 py-2">
                <span className="text-sm">{a.name} <span className="text-xs text-ink-muted">· {a.type}</span></span>
                <span className="tabular text-sm">{formatMoney(a.current_balance_cents, currency)}</span>
              </div>
            ))}
          </div>
          <form onSubmit={addAccount} className="grid grid-cols-3 gap-2">
            <Input name="name" placeholder="Account name" required />
            <Select name="type" defaultValue="bank">
              {["bank", "cash", "investment", "loan", "credit_card", "bond", "savings_pocket"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Input name="balance" type="number" step="0.01" placeholder="Balance" defaultValue="0" />
            <div className="col-span-3"><Button type="submit" variant="ghost">Add account</Button></div>
          </form>
        </Card>

        <Card title="Category taxonomy" subtitle="Default sections from the workbook (editable)">
          <div className="space-y-2">
            {sections.map((s) => (
              <div key={s.id} className="rounded-lg border border-line-soft px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.name}</span>
                  <Badge tone="info">{s.type}</Badge>
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  {categories.filter((c) => c.parent_id === s.id).map((c) => c.name).join(" · ") || "no children"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
