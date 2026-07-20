/**
 * Payment-due reminders: a daily email digest of each household's overdue and
 * soon-due obligations, built from the settlement engine (numbers never invented).
 * Triggered by a scheduled GitHub Actions workflow hitting /api/cron/send-reminders
 * (secured by CRON_SECRET), or on-demand by an admin via /api/reminders/send-now.
 */
import { desc, eq, inArray } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { budgetPeriods, households, memberships, users } from "../db/schema";
import { WRITE_ROLES } from "../lib/enums";
import { emailConfigured, emailShell, sendEmail } from "./email";
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

async function recipientsForHousehold(db: DB, householdId: number) {
  const mems = await db.select().from(memberships).where(eq(memberships.household_id, householdId));
  const ids = mems.filter((m) => WRITE_ROLES.has(m.role)).map((m) => m.user_id);
  if (!ids.length) return [];
  return db.select().from(users).where(inArray(users.id, ids));
}

/** Send one household's digest to the given recipients (or its managing members). */
export async function sendReminderForHousehold(
  env: Env,
  db: DB,
  householdId: number,
  recipients?: { email: string }[],
  dueSoonDays = DEFAULT_DUE_SOON_DAYS,
) {
  const digest = await buildHouseholdDigest(db, householdId, dueSoonDays);
  if (!digest) return { sent: false, reason: "nothing_due" as const, overdue_count: 0, due_soon_count: 0 };
  const to = recipients ?? (await recipientsForHousehold(db, householdId));
  const counts = { overdue_count: digest.overdue.length, due_soon_count: digest.due_soon.length };
  if (!emailConfigured(env)) return { sent: false, reason: "email_not_configured" as const, ...counts };
  if (!to.length) return { sent: false, reason: "no_recipients" as const, ...counts };

  const html = digestHtml(digest);
  const subject = `${digest.overdue.length ? "⚠ Overdue & " : ""}Payments due — ${digest.household_name}`;
  let sent = 0;
  for (const r of to) {
    const res = await sendEmail(env, { to: r.email, subject, html, text: `You have ${digest.overdue.length} overdue and ${digest.due_soon.length} soon-due payments (${money(digest.total_outstanding_cents, digest.currency)} outstanding). Open HFOS → Payments.` });
    if (res.sent) sent += 1;
  }
  return { sent: sent > 0, emails_sent: sent, ...counts };
}

/** Cron entry point: send digests for every household that has something due. */
export async function sendDueReminders(env: Env, db: DB, dueSoonDays = DEFAULT_DUE_SOON_DAYS) {
  const hhs = await db.select().from(households);
  let households_notified = 0;
  let emails_sent = 0;
  for (const hh of hhs) {
    const r = await sendReminderForHousehold(env, db, hh.id, undefined, dueSoonDays);
    if (r.sent) { households_notified += 1; emails_sent += (r as any).emails_sent ?? 0; }
  }
  return { households_scanned: hhs.length, households_notified, emails_sent };
}
