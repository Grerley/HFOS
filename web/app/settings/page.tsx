"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, Badge, PageSkeleton, ErrorState } from "@/components/ui";
import { api, getHouseholdId } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney, toCents } from "@/lib/format";
import type { Category, Household, Member } from "@/lib/types";

interface Account { id: number; name: string; type: string; current_balance_cents: number; }

const CURRENCIES = ["ZAR", "USD", "EUR", "GBP", "AUD", "CAD", "NGN", "KES", "GHS", "INR", "AED", "JPY", "CHF", "CNY", "BWP", "NAD", "ZMW", "MZN"];
const ROLES = ["owner", "partner", "admin", "advisor", "viewer", "child"];
const CATEGORY_TYPES = ["income", "expense", "saving", "investment", "transfer"];

export default function SettingsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [hhForm, setHhForm] = useState({ name: "", base_currency: "ZAR", country: "", budget_cycle_day: 1 });
  const [hhBusy, setHhBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email_sent: boolean; invite_link: string | null } | null>(null);
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [tg, setTg] = useState<{ configured: boolean; linked: boolean; username: string | null } | null>(null);
  const [tgCode, setTgCode] = useState<{ code: string; deep_link: string | null; expires_at: number } | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const currency = useCurrency();

  const isAdmin = household?.role === "owner" || household?.role === "admin";
  const canWrite = ["owner", "partner", "admin"].includes(household?.role ?? "");

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const [m, a, c, hhs] = await Promise.all([
        api.get<Member[]>("/members"),
        api.get<Account[]>("/accounts"),
        api.get<Category[]>("/categories"),
        api.get<Household[]>("/households"),
      ]);
      setMembers(m); setAccounts(a); setCategories(c);
      const activeId = Number(getHouseholdId());
      const hh = hhs.find((h) => h.id === activeId) ?? hhs[0] ?? null;
      setHousehold(hh);
      if (hh) setHhForm({ name: hh.name, base_currency: hh.base_currency, country: hh.country ?? "", budget_cycle_day: hh.budget_cycle_day ?? 1 });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  async function loadTelegram() {
    try { setTg(await api.get("/telegram/status")); } catch { /* leave null */ }
  }
  useEffect(() => { load(); loadTelegram(); }, []);

  async function genTelegramCode() {
    setTgBusy(true);
    try { setTgCode(await api.post("/telegram/link-code", {})); }
    catch (e: any) { alert(e.message); }
    finally { setTgBusy(false); }
  }
  async function unlinkTelegram() {
    if (!confirm("Disconnect Telegram? The bot will stop answering until you reconnect.")) return;
    try { await api.del("/telegram/link"); setTgCode(null); await loadTelegram(); }
    catch (e: any) { alert(e.message); }
  }

  async function saveHousehold(e: React.FormEvent) {
    e.preventDefault();
    if (!household) return;
    setHhBusy(true);
    try {
      const currencyChanged = hhForm.base_currency !== household.base_currency;
      await api.patch(`/households/${household.id}`, hhForm);
      // Currency is read app-wide from the household; reload so it refreshes everywhere.
      if (currencyChanged) { window.location.reload(); return; }
      await load();
    } catch (err: any) { alert(err.message); }
    finally { setHhBusy(false); }
  }

  async function changeRole(m: Member, role: string) {
    try { await api.patch(`/members/${m.id}`, { role }); await load(); }
    catch (err: any) { alert(err.message); }
  }
  async function updateMember(m: Member, patch: Partial<Member>) {
    try { await api.patch(`/members/${m.id}`, patch); await load(); }
    catch (err: any) { alert(err.message); }
  }
  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.name}? ${m.user_id ? "Their login access to this household will be revoked. " : ""}This can't be undone.`)) return;
    try { await api.del(`/members/${m.id}`); await load(); }
    catch (err: any) { alert(err.message); }
  }
  async function removeAccount(a: Account) {
    if (!confirm(`Remove account "${a.name}"? Its balance history is deleted and any budget lines paying from it are detached.`)) return;
    try { await api.del(`/accounts/${a.id}`); await load(); }
    catch (err: any) { alert(err.message); }
  }

  async function renameCategory(c: Category, name: string) {
    if (!name.trim() || name.trim() === c.name) return;
    try { await api.patch(`/categories/${c.id}`, { name: name.trim() }); await load(); }
    catch (err: any) { alert(err.message); }
  }
  async function setCategoryType(c: Category, type: string) {
    try { await api.patch(`/categories/${c.id}`, { type }); await load(); }
    catch (err: any) { alert(err.message); }
  }
  async function deleteCategory(c: Category) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try { await api.del(`/categories/${c.id}`); await load(); }
    catch (err: any) { alert(err.message); } // 409 shows the "in use / has children" reason
  }
  async function addChildCategory(sectionId: number, type: string, e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (new FormData(form).get("name") as string)?.trim();
    if (!name) return;
    try { await api.post("/categories", { name, type, parent_id: sectionId, is_section: false }); form.reset(); await load(); }
    catch (err: any) { alert(err.message); }
  }
  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const f = new FormData(form);
    const name = (f.get("name") as string)?.trim();
    if (!name) return;
    try { await api.post("/categories", { name, type: f.get("type"), is_section: true }); form.reset(); await load(); }
    catch (err: any) { alert(err.message); }
  }

  async function testReminder() {
    setReminderBusy(true);
    setReminderMsg(null);
    try {
      const r = await api.post<any>("/reminders/send-now", {});
      if (r.sent) {
        const via = [r.emails_sent ? "email" : null, r.whatsapp_sent ? "WhatsApp" : null].filter(Boolean).join(" + ");
        setReminderMsg(`Sent via ${via} — ${r.overdue_count} overdue, ${r.due_soon_count} due soon.`);
      } else if (r.reason === "nothing_due") setReminderMsg("Nothing overdue or due within 3 days — no reminder needed right now.");
      else if (r.reason === "not_configured") setReminderMsg(`No channel is configured yet. A live digest would include ${r.overdue_count} overdue and ${r.due_soon_count} due-soon items.`);
      else setReminderMsg(`Not sent (${r.reason ?? "unknown"}).`);
    } catch (e: any) { setReminderMsg(e.message); }
    finally { setReminderBusy(false); }
  }

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
      <PageHeader title="Settings" description="Manage your household, members and accounts." />
      <ErrorState hint="We couldn't load your settings. Check your connection and try again." onRetry={load} />
    </AppShell>
  );

  return (
    <AppShell>
      <PageHeader title="Settings" description="Manage your household, members and accounts." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Household" subtitle={isAdmin ? "Name, currency and cycle" : "Admins can edit these"}>
          <form onSubmit={saveHousehold} className="space-y-3">
            <Field label="Household name">
              <Input value={hhForm.name} onChange={(e) => setHhForm({ ...hhForm, name: e.target.value })} disabled={!isAdmin} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base currency">
                <Select value={hhForm.base_currency} onChange={(e) => setHhForm({ ...hhForm, base_currency: e.target.value })} disabled={!isAdmin}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Budget cycle day (1–28)">
                <Input type="number" min={1} max={28} value={hhForm.budget_cycle_day}
                  onChange={(e) => setHhForm({ ...hhForm, budget_cycle_day: Number(e.target.value) || 1 })} disabled={!isAdmin} />
              </Field>
            </div>
            <Field label="Country">
              <Input value={hhForm.country} onChange={(e) => setHhForm({ ...hhForm, country: e.target.value })} disabled={!isAdmin} placeholder="e.g. ZA" />
            </Field>
            {isAdmin && (
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={hhBusy}>{hhBusy ? "Saving…" : "Save household"}</Button>
                {hhForm.base_currency !== household?.base_currency && (
                  <span className="text-xs text-ink-muted">Changing currency reloads the app to apply it everywhere.</span>
                )}
              </div>
            )}
          </form>
        </Card>

        <Card title="Household members">
          <div className="mb-4 space-y-2">
            {members.map((m) => {
              const managing = ["owner", "partner", "admin"].includes(m.role);
              return (
                <div key={m.id} className="rounded-lg bg-muted px-4 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">{m.name} <span className="text-xs text-ink-muted">· {m.relationship_label || "member"}</span></span>
                    <div className="flex shrink-0 items-center gap-2">
                      {!m.user_id && <Badge tone="warning">pending</Badge>}
                      {isAdmin ? (
                        <>
                          <Select value={m.role} onChange={(e) => changeRole(m, e.target.value)} className="!py-1 text-xs">
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </Select>
                          <button onClick={() => removeMember(m)} title="Remove member" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>
                        </>
                      ) : <Badge>{m.role}</Badge>}
                    </div>
                  </div>
                  {isAdmin && managing && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-2 text-xs text-ink-soft">
                      <span className="font-medium text-ink-muted">Reminders:</span>
                      <label className="flex items-center gap-1"><input type="checkbox" checked={m.notify_email ?? true} onChange={(e) => updateMember(m, { notify_email: e.target.checked })} /> Email</label>
                      <label className="flex items-center gap-1"><input type="checkbox" checked={m.notify_whatsapp ?? false} onChange={(e) => updateMember(m, { notify_whatsapp: e.target.checked })} /> WhatsApp</label>
                      <input
                        type="tel" defaultValue={m.phone ?? ""} placeholder="+27 82 000 0000"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.phone ?? "")) updateMember(m, { phone: v || null }); }}
                        className="w-40 rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-brand"
                        title="WhatsApp number in international format (E.164), e.g. +27820000000"
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {!members.length && <p className="text-sm text-ink-muted">No members yet.</p>}
          </div>
          <form onSubmit={addMember} className="grid grid-cols-3 gap-2">
            <Input name="name" placeholder="Name" required />
            <Input name="rel" placeholder="Relationship" />
            <Select name="role" defaultValue="partner">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
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

        <Card title="Payment reminders" subtitle="Daily digest of overdue & soon-due payments">
          <p className="mb-3 text-sm text-ink-soft">
            Managing members get a daily digest when payments are overdue or due within 3 days, over their chosen channels
            (Email now; WhatsApp once configured — set each person's channels and number above). Send yourself one now to preview it.
          </p>
          <Button variant="ghost" onClick={testReminder} disabled={reminderBusy}>
            {reminderBusy ? "Sending…" : "Send me a test reminder"}
          </Button>
          {reminderMsg && <p className="mt-2 text-xs text-ink-muted">{reminderMsg}</p>}
        </Card>

        <Card title="Connect Telegram" subtitle="Ask your copilot from Telegram">
          {!tg?.configured ? (
            <p className="text-sm text-ink-soft">
              The Telegram bot isn't set up on the server yet. Once an admin adds the bot token, you'll be able to link
              this household here and chat with your copilot from Telegram.
            </p>
          ) : tg.linked ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <Badge tone="positive">Connected</Badge> This household is linked to Telegram — ask the bot anything about your budget.
              </p>
              <Button variant="ghost" onClick={unlinkTelegram}>Disconnect Telegram</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">
                Generate a one-time code, then send it to the bot as <span className="font-mono">/link &lt;code&gt;</span>. It expires in 15 minutes.
              </p>
              {!tgCode ? (
                <Button onClick={genTelegramCode} disabled={tgBusy}>{tgBusy ? "Generating…" : "Generate link code"}</Button>
              ) : (
                <div className="rounded-lg border border-line-soft p-3 text-sm">
                  <div>Your code: <span className="font-mono text-base font-semibold tracking-widest">{tgCode.code}</span></div>
                  {tgCode.deep_link ? (
                    <a href={tgCode.deep_link} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium text-brand-dark hover:underline">
                      Open the bot and connect →
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">In Telegram, open your bot and send: <span className="font-mono">/link {tgCode.code}</span></p>
                  )}
                  <button onClick={genTelegramCode} className="mt-2 block text-xs text-ink-muted hover:underline">Generate a new code</button>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Accounts">
          <div className="mb-4 space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-4 py-2">
                <span className="min-w-0 truncate text-sm">{a.name} <span className="text-xs text-ink-muted">· {a.type}</span></span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-sm">{formatMoney(a.current_balance_cents, currency)}</span>
                  <button onClick={() => removeAccount(a)} title="Remove account" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>
                </div>
              </div>
            ))}
            {!accounts.length && <p className="text-sm text-ink-muted">No accounts yet.</p>}
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

        <Card title="Category taxonomy" subtitle={canWrite ? "Rename, add or remove sections and sub-categories" : "Sections and sub-categories"} className="lg:col-span-2">
          <div className="space-y-3">
            {sections.map((s) => (
              <div key={s.id} className="rounded-lg border border-line-soft px-4 py-3">
                <div className="flex items-center gap-2">
                  {canWrite ? (
                    <input defaultValue={s.name} onBlur={(e) => renameCategory(s, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none hover:border-line focus:border-brand focus:bg-card" />
                  ) : <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>}
                  {canWrite ? (
                    <Select value={s.type} onChange={(e) => setCategoryType(s, e.target.value)} className="!w-auto !py-1 text-xs">
                      {CATEGORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  ) : <Badge tone="info">{s.type}</Badge>}
                  {canWrite && <button onClick={() => deleteCategory(s)} title="Delete section" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>}
                </div>

                <div className="mt-2 space-y-1 pl-3">
                  {categories.filter((c) => c.parent_id === s.id).map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <span className="text-ink-muted" aria-hidden>·</span>
                      {canWrite ? (
                        <input defaultValue={c.name} onBlur={(e) => renameCategory(c, e.target.value)}
                          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-line focus:border-brand focus:bg-card" />
                      ) : <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>}
                      {canWrite && <button onClick={() => deleteCategory(c)} title="Delete sub-category" className="rounded px-1.5 text-xs text-ink-muted hover:text-negative">✕</button>}
                    </div>
                  ))}
                  {!categories.some((c) => c.parent_id === s.id) && <p className="text-xs text-ink-muted">No sub-categories.</p>}
                  {canWrite && (
                    <form onSubmit={(e) => addChildCategory(s.id, s.type, e)} className="flex items-center gap-2 pt-1">
                      <Input name="name" placeholder={`Add sub-category to ${s.name}…`} className="!py-1 text-xs" />
                      <Button type="submit" variant="ghost">Add</Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
            {!sections.length && <p className="text-sm text-ink-muted">No sections yet.</p>}

            {canWrite && (
              <form onSubmit={addSection} className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                <Input name="name" placeholder="New section name" className="max-w-[14rem]" />
                <Select name="type" defaultValue="expense" className="!w-auto">
                  {CATEGORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Button type="submit" variant="ghost">Add section</Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
