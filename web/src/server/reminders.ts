/**
 * Payment-due reminders: a daily email digest of each household's overdue and
 * soon-due obligations, built from the settlement engine (numbers never invented).
 * Triggered by a scheduled GitHub Actions workflow hitting /api/cron/send-reminders
 * (secured by CRON_SECRET), or on-demand by an admin via /api/reminders/send-now.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { budgetPeriods, households, householdMembers, users } from "../db/schema";
import { WRITE_ROLES } from "../lib/enums";
import { emailConfigured, emailShell, sendEmail } from "./email";
import { sendWhatsApp, whatsappConfigured } from "./notify";
import { periodSettlement, todayISO } from "./payments";

const DEFAULT_DUE_SOON_DAYS = 3;

function money(cents: number, currency: string): string {
  const v = (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${v}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DigestLine {
  item_name: string;
  category_name: string | null;
  due_date: string | null;
  outstanding_cents: number;
  responsible: string | null;
}
export interface HouseholdDigest {
  household_id: number;
  household_name: string;
  currency: string;
  overdue: DigestLine[];
  due_soon: DigestLine[];
  total_outstanding_cents: number;
}

/** Build a household's reminder digest, or null when nothing needs attention. */
export async function buildHouseholdDigest(
  db: DB,
  householdId: number,
  dueSoonDays = DEFAULT_DUE_SOON_DAYS,
): Promise<HouseholdDigest | null> {
  const period = (await db.select().from(budgetPeriods)
    .where(eq(budgetPeriods.household_id, householdId))
    .orderBy(desc(budgetPeriods.start_date)).limit(1)).at(0);
  if (!period) return null;

  const settle = await periodSettlement(db, householdId, period.id);
  const today = settle.today;
  const soonCutoff = addDaysISO(today, dueSoonDays);
  const hh = (await db.select().from(households).where(eq(households.id, householdId))).at(0);
  const currency = hh?.base_currency ?? "ZAR";

  const map = (l: any): DigestLine => ({
    item_name: l.item_name, category_name: l.category_name, due_date: l.due_date,
    outstanding_cents: l.outstanding_cents, responsible: l.responsible_member_name ?? null,
  });

  const overdue = settle.lines.filter((l: any) => l.outstanding_cents > 0 && l.is_overdue).map(map);
  const due_soon = settle.lines
    .filter((l: any) => l.outstanding_cents > 0 && !l.is_overdue && l.due_date && l.due_date >= today && l.due_date <= soonCutoff)
    .map(map);

  if (!overdue.length && !due_soon.length) return null;
  const total = [...overdue, ...due_soon].reduce((s, l) => s + l.outstanding_cents, 0);
  return {
    household_id: householdId,
    household_name: hh?.name ?? "your household",
    currency,
    overdue,
    due_soon,
    total_outstanding_cents: total,
  };
}

function digestHtml(d: HouseholdDigest): string {
  const row = (l: DigestLine) =>
    `<tr>
       <td style="padding:6px 8px;border-top:1px solid #e4e8ef;font-size:13px;">${l.item_name}${l.responsible ? ` <span style="color:#6b7891;">· ${l.responsible}</span>` : ""}</td>
       <td style="padding:6px 8px;border-top:1px solid #e4e8ef;font-size:13px;color:#6b7891;">${l.due_date ?? "—"}</td>
       <td style="padding:6px 8px;border-top:1px solid #e4e8ef;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${money(l.outstanding_cents, d.currency)}</td>
     </tr>`;
  const section = (title: string, color: string, lines: DigestLine[]) =>
    lines.length
      ? `<p style="margin:16px 0 4px;font-weight:600;color:${color};font-size:13px;">${title} (${lines.length})</p>
         <table style="width:100%;border-collapse:collapse;"><tbody>${lines.map(row).join("")}</tbody></table>`
      : "";
  return emailShell(
    `Payments due in ${d.household_name}`,
    `<p style="font-size:14px;line-height:1.5;">${money(d.total_outstanding_cents, d.currency)} outstanding needs attention.</p>
     ${section("Overdue", "#b91c1c", d.overdue)}
     ${section("Due soon", "#b45309", d.due_soon)}
     <p style="margin-top:16px;font-size:12px;color:#6b7891;">Open HFOS → Payments to settle these or confirm your debit orders.</p>`,
  );
}

/** Concise plain-text digest for WhatsApp/SMS-style channels. */
function digestText(d: HouseholdDigest): string {
  const line = (l: DigestLine) => `${l.item_name} ${money(l.outstanding_cents, d.currency)}${l.due_date ? ` (due ${l.due_date})` : ""}`;
  const parts = [`HFOS · ${d.household_name}: ${money(d.total_outstanding_cents, d.currency)} outstanding.`];
  if (d.overdue.length) parts.push(`Overdue (${d.overdue.length}): ${d.overdue.map(line).join("; ")}`);
  if (d.due_soon.length) parts.push(`Due soon (${d.due_soon.length}): ${d.due_soon.map(line).join("; ")}`);
  parts.push("Open HFOS → Payments to settle these.");
  return parts.join("\n");
}

interface DeliveryTarget {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  wantEmail: boolean;
  wantWhatsApp: boolean;
}

/** Deliver a digest to targets over each opted-in, configured channel. */
async function deliver(env: Env, digest: HouseholdDigest, targets: DeliveryTarget[]) {
  const html = digestHtml(digest);
  const text = digestText(digest);
  const subject = `${digest.overdue.length ? "⚠ Overdue & " : ""}Payments due — ${digest.household_name}`;
  const emailOn = emailConfigured(env);
  const waOn = whatsappConfigured(env);
  let emails_sent = 0;
  let whatsapp_sent = 0;
  for (const t of targets) {
    if (t.wantEmail && t.email && emailOn) {
      const r = await sendEmail(env, { to: t.email, subject, html, text });
      if (r.sent) emails_sent += 1;
    }
    if (t.wantWhatsApp && t.phone && waOn) {
      // Structured params for the approved Meta template (see docs/WHATSAPP_TEMPLATE.md):
      // {{1}} name, {{2}} household, {{3}} total, {{4}} overdue count, {{5}} due-soon count.
      const params = [
        t.name || "there",
        digest.household_name,
        money(digest.total_outstanding_cents, digest.currency),
        String(digest.overdue.length),
        String(digest.due_soon.length),
      ];
      const r = await sendWhatsApp(env, t.phone, { text, params });
      if (r.sent) whatsapp_sent += 1;
    }
  }
  return { emails_sent, whatsapp_sent };
}

/** Managing members (owner/partner/admin) as delivery targets, per their channel prefs. */
async function managingTargets(db: DB, householdId: number): Promise<DeliveryTarget[]> {
  const members = (await db.select().from(householdMembers).where(eq(householdMembers.household_id, householdId)))
    .filter((m) => m.is_active && WRITE_ROLES.has(m.role));
  const userIds = members.map((m) => m.user_id).filter((x): x is number => x != null);
  const emailByUser = new Map<number, string>();
  if (userIds.length) {
    for (const u of await db.select().from(users).where(inArray(users.id, userIds))) emailByUser.set(u.id, u.email);
  }
  return members.map((m) => ({
    name: m.name,
    email: m.user_id ? emailByUser.get(m.user_id) ?? null : null,
    phone: m.phone,
    wantEmail: m.notify_email,
    wantWhatsApp: m.notify_whatsapp,
  }));
}

export async function sendReminderForHousehold(env: Env, db: DB, householdId: number, dueSoonDays = DEFAULT_DUE_SOON_DAYS) {
  const digest = await buildHouseholdDigest(db, householdId, dueSoonDays);
  const counts = { overdue_count: digest?.overdue.length ?? 0, due_soon_count: digest?.due_soon.length ?? 0 };
  if (!digest) return { sent: false, reason: "nothing_due" as const, ...counts };
  if (!emailConfigured(env) && !whatsappConfigured(env)) return { sent: false, reason: "not_configured" as const, ...counts };
  const targets = await managingTargets(db, householdId);
  if (!targets.length) return { sent: false, reason: "no_recipients" as const, ...counts };
  const { emails_sent, whatsapp_sent } = await deliver(env, digest, targets);
  return { sent: emails_sent + whatsapp_sent > 0, emails_sent, whatsapp_sent, ...counts };
}

/** Admin "send me a test" — delivers this household's digest to the calling user's own channels. */
export async function sendReminderToUser(env: Env, db: DB, householdId: number, userId: number, dueSoonDays = DEFAULT_DUE_SOON_DAYS) {
  const digest = await buildHouseholdDigest(db, householdId, dueSoonDays);
  const counts = { overdue_count: digest?.overdue.length ?? 0, due_soon_count: digest?.due_soon.length ?? 0 };
  if (!digest) return { sent: false, reason: "nothing_due" as const, ...counts };
  if (!emailConfigured(env) && !whatsappConfigured(env)) return { sent: false, reason: "not_configured" as const, ...counts };
  const user = (await db.select().from(users).where(eq(users.id, userId))).at(0);
  const member = (await db.select().from(householdMembers).where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))).at(0);
  const target: DeliveryTarget = {
    name: member?.name ?? user?.name ?? null,
    email: user?.email ?? null,
    phone: member?.phone ?? null,
    wantEmail: true, // a test always tries email so the admin gets it
    wantWhatsApp: !!(member?.notify_whatsapp && member?.phone),
  };
  const { emails_sent, whatsapp_sent } = await deliver(env, digest, [target]);
  return { sent: emails_sent + whatsapp_sent > 0, emails_sent, whatsapp_sent, ...counts };
}

/** Cron entry point: send digests for every household that has something due. */
export async function sendDueReminders(env: Env, db: DB, dueSoonDays = DEFAULT_DUE_SOON_DAYS) {
  const hhs = await db.select().from(households);
  let households_notified = 0;
  let emails_sent = 0;
  let whatsapp_sent = 0;
  for (const hh of hhs) {
    const r = await sendReminderForHousehold(env, db, hh.id, dueSoonDays);
    if (r.sent) { households_notified += 1; emails_sent += (r as any).emails_sent ?? 0; whatsapp_sent += (r as any).whatsapp_sent ?? 0; }
  }
  return { households_scanned: hhs.length, households_notified, emails_sent, whatsapp_sent };
}
