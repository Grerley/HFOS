/** Minimal method+path router → handlers. Mounted under /api by the catch-all route. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getEnv, secret } from "../db/client";
import {
  accountBalances,
  accounts,
  budgetLineAllocations,
  budgetLines,
  budgetPeriods,
  categories,
  expenseComments,
  goals,
  households,
  householdMembers,
  insights,
  memberships,
  properties,
  propertyCashFlows,
  scenarios,
  transactions,
  users,
} from "../db/schema";
import * as calc from "../lib/calc";
import { createAccessToken } from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/hash";
import { validatePassword } from "../lib/password";
import {
  checkLoginRateLimit,
  checkRegisterRateLimit,
  checkResetRateLimit,
  clearLoginFailures,
  clientIp,
  normalizeEmail,
  recordAttempt,
} from "./security";
import { emailConfigured, emailShell, sendEmail } from "./email";
import { consumeResetToken, createResetToken } from "./passwordReset";
import { acceptInvite, createInvite, getInviteByToken } from "./invites";
import { derivePaymentFlags, LOCKED_STATUSES, PeriodStatus } from "../lib/enums";
import {
  Ctx,
  HttpError,
  errorResponse,
  json,
  requireAdmin,
  requireAuth,
  requireWrite,
} from "./context";
import { applyBatch, backfillDueDates, deriveDueDate, duplicatePeriod, loadLinesForCalc, provisionHousehold, recordAudit } from "./services";
import { generatePeriodInsights, runScenario } from "./insights";
import { analyzeWorkbook, importWorkbook } from "./import";
import {
  addPayment,
  bulkMarkPaid,
  editPayment,
  markPaidInFull,
  paymentHistory,
  periodSettlement,
  reversePayment,
  softDeletePayment,
} from "./payments";
import { cashFlowForecast } from "./cashflow";
import { copilotAnswer } from "./copilot";

async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
function qp(req: Request, key: string): string | null {
  return new URL(req.url).searchParams.get(key);
}

async function tokenResponse(db: ReturnType<typeof getDb>, user: typeof users.$inferSelect) {
  const secretKey = secret(getEnv());
  const rows = await db.select().from(memberships).where(eq(memberships.user_id, user.id));
  const hhRows = rows.length
    ? await db.select().from(households).where(inArray(households.id, rows.map((m) => m.household_id)))
    : [];
  const roleByHh = new Map(rows.map((m) => [m.household_id, m.role]));
  return json({
    access_token: await createAccessToken(String(user.id), secretKey),
    token_type: "bearer",
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, is_active: user.is_active },
    households: hhRows.map((h) => ({
      id: h.id, name: h.name, base_currency: h.base_currency, country: h.country,
      budget_cycle_day: h.budget_cycle_day, role: roleByHh.get(h.id) ?? null,
    })),
  });
}

async function getScoped<T extends { household_id?: number | null }>(
  rows: Promise<T[]>,
  householdId: number,
  label: string,
): Promise<T> {
  const r = (await rows).at(0);
  if (!r || r.household_id !== householdId) throw new HttpError(404, `${label} not found`);
  return r;
}

const LIABILITY_TYPES = new Set(["loan", "credit_card", "bond"]);

function monthsBetween(target: string | null): number {
  if (!target) return 0;
  const t = new Date(target);
  const now = new Date();
  return Math.max((t.getFullYear() - now.getFullYear()) * 12 + (t.getMonth() - now.getMonth()), 0);
}
function enrichGoal(g: typeof goals.$inferSelect) {
  const months = monthsBetween(g.target_date);
  return {
    ...g,
    progress: calc.goalProgress(g.target_amount_cents, g.current_amount_cents),
    months_remaining: months,
    monthly_required_cents: calc.goalMonthlyRequirement(g.target_amount_cents, g.current_amount_cents, months),
  };
}

async function resolvePeriod(ctx: Ctx, periodIdRaw: string | null) {
  if (periodIdRaw) return getScoped(
    ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(periodIdRaw))),
    ctx.householdId, "Budget period",
  );
  return (await ctx.db.select().from(budgetPeriods)
    .where(eq(budgetPeriods.household_id, ctx.householdId))
    .orderBy(desc(budgetPeriods.start_date)).limit(1)).at(0) ?? null;
}

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;

const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, path: string, handler: Handler) {
  const names: string[] = [];
  const rx = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
  routes.push([method, rx, names, handler]);
}

// ── Auth ────────────────────────────────────────────────────────────────────
route("POST", "/auth/register", async (req) => {
  const env = getEnv();
  const db = getDb(env);
  const p = await body(req);
  const ip = clientIp(req);
  const emailKey = normalizeEmail(p.email);

  const rl = await checkRegisterRateLimit(db, ip);
  if (rl.limited) {
    await recordAttempt(db, "register", emailKey, ip, "rate_limited");
    await recordAudit(db, { action: "auth.register_rate_limited", entity_type: "auth", detail: { ip } });
    throw new HttpError(429, "Too many sign-ups from this network. Please try again later.");
  }
  if (!p.email || !p.password) throw new HttpError(422, "Email and password are required");
  const pwError = validatePassword(p.password, p.email);
  if (pwError) throw new HttpError(422, pwError);

  const existing = await db.select().from(users).where(eq(users.email, p.email));
  if (existing.length) throw new HttpError(409, "Email already registered");
  const [user] = await db.insert(users).values({
    name: p.name, email: p.email, phone: p.phone ?? null, password_hash: await hashPassword(p.password),
  }).returning();
  await provisionHousehold(db, { id: user.id, name: user.name }, { name: p.household_name || `${p.name}'s household` });
  await recordAttempt(db, "register", emailKey, ip, "success");
  await recordAudit(db, { action: "auth.register", entity_type: "user", entity_id: user.id, actor_user_id: user.id, detail: { ip } });
  return tokenResponse(db, user);
});

async function loginHandler(req: Request) {
  const db = getDb(getEnv());
  const p = await body(req);
  const email = p.email ?? p.username;
  const emailKey = normalizeEmail(email);
  const ip = clientIp(req);

  const rl = await checkLoginRateLimit(db, emailKey, ip);
  if (rl.limited) {
    await recordAttempt(db, "login", emailKey, ip, "rate_limited");
    await recordAudit(db, { action: "auth.login_rate_limited", entity_type: "auth", detail: { email: emailKey, ip, reason: rl.reason } });
    throw new HttpError(429, `Too many attempts. Please try again in about ${Math.ceil(rl.retryAfterSec / 60)} minutes.`);
  }

  const user = (await db.select().from(users).where(eq(users.email, email))).at(0);
  if (!user || !(await verifyPassword(p.password, user.password_hash))) {
    await recordAttempt(db, "login", emailKey, ip, user ? "bad_password" : "no_user");
    await recordAudit(db, { action: "auth.login_failed", entity_type: "auth", actor_user_id: user?.id ?? null, detail: { email: emailKey, ip, reason: user ? "bad_password" : "no_user" } });
    throw new HttpError(401, "Invalid email or password");
  }
  await clearLoginFailures(db, emailKey);
  await recordAttempt(db, "login", emailKey, ip, "success");
  await recordAudit(db, { action: "auth.login_success", entity_type: "user", entity_id: user.id, actor_user_id: user.id, detail: { ip } });
  return tokenResponse(db, user);
}
route("POST", "/auth/login", loginHandler);
route("POST", "/auth/login/json", loginHandler);

// ── Password reset (no account enumeration; email may be disabled) ────────────
route("POST", "/auth/forgot-password", async (req) => {
  const env = getEnv();
  const db = getDb(env);
  const p = await body(req);
  const emailKey = normalizeEmail(p.email);
  const ip = clientIp(req);

  const rl = await checkResetRateLimit(db, emailKey, ip);
  if (rl.limited) {
    await recordAttempt(db, "reset", emailKey, ip, "rate_limited");
    throw new HttpError(429, "Too many reset requests. Please try again later.");
  }
  await recordAttempt(db, "reset", emailKey, ip, "requested");

  const user = emailKey ? (await db.select().from(users).where(eq(users.email, p.email))).at(0) : undefined;
  if (user) {
    const token = await createResetToken(db, user.id);
    const link = `${new URL(req.url).origin}/reset-password?token=${token}`;
    const html = emailShell(
      "Reset your password",
      `<p style="font-size:14px;line-height:1.5;">We received a request to reset your HFOS password. This link expires in 1 hour.</p>
       <p style="margin:20px 0;"><a href="${link}" style="display:inline-block;background:#16324f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;">Reset password</a></p>
       <p style="color:#6b7891;font-size:12px;line-height:1.5;">If the button doesn't work, paste this into your browser:<br>${link}</p>
       <p style="color:#6b7891;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>`,
    );
    await sendEmail(env, { to: p.email, subject: "Reset your HFOS password", html, text: `Reset your HFOS password (expires in 1 hour): ${link}` });
    await recordAudit(db, { action: "auth.reset_requested", entity_type: "user", entity_id: user.id, actor_user_id: user.id, detail: { ip } });
  }
  // Identical response whether or not the email exists.
  return json({ ok: true, message: "If that email is registered, a reset link is on its way." });
});

route("POST", "/auth/reset-password", async (req) => {
  const db = getDb(getEnv());
  const p = await body(req);
  if (!p.token || !p.password) throw new HttpError(422, "Token and new password are required");
  const pwError = validatePassword(p.password);
  if (pwError) throw new HttpError(422, pwError);
  const result = await consumeResetToken(db, p.token, p.password);
  if (!result.ok) {
    const msg =
      result.reason === "expired" ? "This reset link has expired — request a new one."
      : result.reason === "used" ? "This reset link has already been used."
      : "This reset link is invalid.";
    throw new HttpError(400, msg);
  }
  await recordAudit(db, { action: "auth.reset_completed", entity_type: "user", entity_id: result.userId, actor_user_id: result.userId ?? null });
  return json({ ok: true, message: "Your password has been reset. You can now sign in." });
});

route("GET", "/auth/me", async (req) => {
  const ctx = await requireAuth(req);
  const user = (await ctx.db.select().from(users).where(eq(users.id, ctx.userId))).at(0)!;
  return tokenResponse(ctx.db, user);
});

// ── Households & members ──────────────────────────────────────────────────────
route("POST", "/households", async (req) => {
  const ctx = await requireAuth(req);
  const p = await body(req);
  const user = (await ctx.db.select().from(users).where(eq(users.id, ctx.userId))).at(0)!;
  const hh = await provisionHousehold(ctx.db, { id: user.id, name: user.name }, p);
  return json({ ...hh, role: "owner" }, 201);
});
route("GET", "/households", async (req) => {
  const ctx = await requireAuth(req);
  const rows = await ctx.db.select().from(memberships).where(eq(memberships.user_id, ctx.userId));
  const hhRows = rows.length ? await ctx.db.select().from(households).where(inArray(households.id, rows.map((m) => m.household_id))) : [];
  const roleByHh = new Map(rows.map((m) => [m.household_id, m.role]));
  return json(hhRows.map((h) => ({ id: h.id, name: h.name, base_currency: h.base_currency, country: h.country, budget_cycle_day: h.budget_cycle_day, role: roleByHh.get(h.id) })));
});
route("GET", "/members", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(householdMembers).where(eq(householdMembers.household_id, ctx.householdId)));
});
route("POST", "/members", async (req) => {
  const ctx = await requireAuth(req); requireAdmin(ctx);
  const p = await body(req);
  let userId: number | null = null;
  if (p.user_email) userId = (await ctx.db.select().from(users).where(eq(users.email, p.user_email))).at(0)?.id ?? null;
  const [m] = await ctx.db.insert(householdMembers).values({
    household_id: ctx.householdId, user_id: userId, name: p.name, relationship_label: p.relationship_label ?? null, role: p.role ?? "partner",
  }).returning();
  await recordAudit(ctx.db, { action: "member.create", entity_type: "household_member", entity_id: m.id, household_id: ctx.householdId, actor_user_id: ctx.userId, detail: { name: p.name } });
  return json(m, 201);
});
route("POST", "/members/invite", async (req) => {
  const ctx = await requireAuth(req); requireAdmin(ctx);
  const p = await body(req);
  const { invite, member, token } = await createInvite(ctx.db, ctx.householdId, ctx.userId, p);
  const link = `${new URL(req.url).origin}/accept-invite?token=${token}`;

  const hh = (await ctx.db.select().from(households).where(eq(households.id, ctx.householdId))).at(0);
  const inviter = (await ctx.db.select().from(users).where(eq(users.id, ctx.userId))).at(0);
  let email_sent = false;
  if (emailConfigured(getEnv())) {
    const html = emailShell(
      `You've been invited to ${hh?.name ?? "a household"} on HFOS`,
      `<p style="font-size:14px;line-height:1.5;">${inviter?.name ?? "Someone"} invited you to join <strong>${hh?.name ?? "their household"}</strong> on HFOS as ${invite.role}. This link expires in 7 days.</p>
       <p style="margin:20px 0;"><a href="${link}" style="display:inline-block;background:#16324f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;">Accept invitation</a></p>
       <p style="color:#6b7891;font-size:12px;line-height:1.5;">Or paste this into your browser:<br>${link}</p>`,
    );
    const r = await sendEmail(getEnv(), { to: invite.email, subject: `Join ${hh?.name ?? "a household"} on HFOS`, html, text: `Accept your HFOS invitation (expires in 7 days): ${link}` });
    email_sent = r.sent;
  }
  await recordAudit(ctx.db, { action: "member.invited", entity_type: "invite", entity_id: invite.id, household_id: ctx.householdId, actor_user_id: ctx.userId, detail: { email: invite.email, role: invite.role, email_sent } });
  // If email is off, return the link so the admin can share it manually.
  return json({ member, email_sent, invite_link: email_sent ? null : link }, 201);
});

// ── Public invite acceptance (no auth) ────────────────────────────────────────
route("GET", "/invites/:token", async (_req, params) => {
  const db = getDb(getEnv());
  const info = await getInviteByToken(db, params.token);
  if (!info) throw new HttpError(404, "This invite link is invalid.");
  const { _inv, ...safe } = info;
  return json(safe);
});
route("POST", "/invites/:token/accept", async (req, params) => {
  const db = getDb(getEnv());
  const p = await body(req);
  const { user, created } = await acceptInvite(db, params.token, p);
  await recordAudit(db, { action: "member.invite_accepted", entity_type: "user", entity_id: user.id, actor_user_id: user.id, detail: { created } });
  // New accounts are auto-signed-in; existing accounts must sign in themselves.
  if (created) return tokenResponse(db, user);
  return json({ ok: true, created: false, message: "You've been added to the household. Please sign in." });
});

// ── Accounts & categories ─────────────────────────────────────────────────────
route("GET", "/accounts", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(accounts).where(eq(accounts.household_id, ctx.householdId)));
});
route("POST", "/accounts", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const [a] = await ctx.db.insert(accounts).values({
    household_id: ctx.householdId, name: p.name, type: p.type, institution: p.institution ?? null,
    owner_member_id: p.owner_member_id ?? null, currency: p.currency ?? "ZAR",
    current_balance_cents: p.current_balance_cents ?? 0, balance_date: p.balance_date ?? null, is_manual: p.is_manual ?? true,
  }).returning();
  if (p.balance_date) await ctx.db.insert(accountBalances).values({ account_id: a.id, as_of: p.balance_date, balance_cents: p.current_balance_cents ?? 0 });
  return json(a, 201);
});
route("POST", "/accounts/:id/balances", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const acc = await getScoped(ctx.db.select().from(accounts).where(eq(accounts.id, Number(params.id))), ctx.householdId, "Account");
  await ctx.db.insert(accountBalances).values({ account_id: acc.id, as_of: p.as_of, balance_cents: p.balance_cents });
  if (!acc.balance_date || p.as_of >= acc.balance_date)
    await ctx.db.update(accounts).set({ current_balance_cents: p.balance_cents, balance_date: p.as_of }).where(eq(accounts.id, acc.id));
  return json((await ctx.db.select().from(accounts).where(eq(accounts.id, acc.id))).at(0));
});
route("GET", "/categories", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(categories).where(eq(categories.household_id, ctx.householdId)).orderBy(categories.sort_order));
});
route("POST", "/categories", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const [c] = await ctx.db.insert(categories).values({
    household_id: ctx.householdId, name: p.name, type: p.type, parent_id: p.parent_id ?? null,
    default_owner_member_id: p.default_owner_member_id ?? null, sort_order: p.sort_order ?? 0, is_section: p.is_section ?? false,
  }).returning();
  return json(c, 201);
});

// ── Budget ────────────────────────────────────────────────────────────────────
route("GET", "/budget-periods", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.household_id, ctx.householdId)).orderBy(desc(budgetPeriods.start_date)));
});
route("POST", "/budget-periods", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const [period] = await ctx.db.insert(budgetPeriods).values({
    household_id: ctx.householdId, label: p.label, start_date: p.start_date, end_date: p.end_date, status: p.status ?? "draft", source: "manual", notes: p.notes ?? null,
  }).returning();
  return json(period, 201);
});
route("POST", "/budget-periods/:id/duplicate", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const source = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  const np = await duplicatePeriod(ctx.db, ctx.householdId, source, {
    label: p.label, start_date: p.start_date, end_date: p.end_date, copy_ad_hoc: p.copy_ad_hoc ?? false,
    adjust: p.adjust ?? undefined,
  }, ctx.userId);
  return json(np, 201);
});
route("PATCH", "/budget-periods/:id/status", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  if (!Object.values(PeriodStatus).includes(p.status)) throw new HttpError(422, "Invalid status");
  const period = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  const today = new Date().toISOString().slice(0, 10);
  const patch: any = { status: p.status };
  if (LOCKED_STATUSES.has(p.status)) patch.locked_at = today;
  if (p.status === PeriodStatus.APPROVED) patch.approved_at = today;
  await ctx.db.update(budgetPeriods).set(patch).where(eq(budgetPeriods.id, period.id));
  await recordAudit(ctx.db, { action: "budget_period.status", entity_type: "budget_period", entity_id: period.id, household_id: ctx.householdId, actor_user_id: ctx.userId, detail: { from: period.status, to: p.status } });
  return json((await ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, period.id))).at(0));
});
route("GET", "/budget-periods/:id/lines", async (req, params) => {
  const ctx = await requireAuth(req);
  await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  return json(await ctx.db.select().from(budgetLines).where(eq(budgetLines.period_id, Number(params.id))).orderBy(budgetLines.sort_order, budgetLines.id));
});
route("POST", "/budget-periods/:id/lines", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const period = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  if (LOCKED_STATUSES.has(period.status)) throw new HttpError(409, "Period is locked");
  const p = await body(req);
  const [line] = await ctx.db.insert(budgetLines).values({
    period_id: period.id, household_id: ctx.householdId, category_id: p.category_id, item_name: p.item_name,
    owner_member_id: p.owner_member_id ?? null, planned_amount_cents: p.planned_amount_cents ?? 0, actual_amount_cents: p.actual_amount_cents ?? 0,
    due_day: p.due_day ?? null, due_date: p.due_date ?? deriveDueDate(period, p.due_day),
    payment_status: p.payment_status ?? "planned", payment_type: p.payment_type ?? "manual", ...derivePaymentFlags(p.payment_type),
    is_recurring: p.is_recurring ?? true, priority: p.priority ?? 3, notes: p.notes ?? null,
  }).returning();
  return json(line, 201);
});
route("POST", "/maintenance/backfill-due-dates", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const day = p.default_due_day != null ? Number(p.default_due_day) : null;
  return json(await backfillDueDates(ctx.db, ctx.householdId, ctx.userId, day));
});
route("POST", "/budget-periods/:id/lines/batch", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const period = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  return json(await applyBatch(ctx.db, ctx.householdId, period, await body(req), ctx.userId));
});
route("PATCH", "/budget-lines/:id", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const line = await getScoped(ctx.db.select().from(budgetLines).where(eq(budgetLines.id, Number(params.id))), ctx.householdId, "Line");
  const p = await body(req);
  const { allocations, ...patch } = p;
  await ctx.db.update(budgetLines).set(patch).where(eq(budgetLines.id, line.id));
  return json((await ctx.db.select().from(budgetLines).where(eq(budgetLines.id, line.id))).at(0));
});
route("DELETE", "/budget-lines/:id", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const line = await getScoped(ctx.db.select().from(budgetLines).where(eq(budgetLines.id, Number(params.id))), ctx.householdId, "Line");
  await ctx.db.delete(budgetLineAllocations).where(eq(budgetLineAllocations.line_id, line.id));
  await ctx.db.delete(budgetLines).where(eq(budgetLines.id, line.id));
  return new Response(null, { status: 204 });
});
route("GET", "/transactions", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(transactions).where(eq(transactions.household_id, ctx.householdId)).orderBy(desc(transactions.date)));
});
route("POST", "/transactions", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const [t] = await ctx.db.insert(transactions).values({
    household_id: ctx.householdId, account_id: p.account_id ?? null, date: p.date, description: p.description, merchant: p.merchant ?? null,
    amount_cents: p.amount_cents, category_id: p.category_id ?? null, budget_line_id: p.budget_line_id ?? null, is_transfer: p.is_transfer ?? false, transfer_account_id: p.transfer_account_id ?? null, source: "manual", notes: p.notes ?? null,
  }).returning();
  if (p.budget_line_id) {
    const line = (await ctx.db.select().from(budgetLines).where(eq(budgetLines.id, p.budget_line_id))).at(0);
    if (line && line.household_id === ctx.householdId)
      await ctx.db.update(budgetLines).set({ actual_amount_cents: line.actual_amount_cents + Math.abs(p.amount_cents) }).where(eq(budgetLines.id, line.id));
  }
  return json(t, 201);
});

// ── Property ──────────────────────────────────────────────────────────────────
route("GET", "/properties", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(properties).where(eq(properties.household_id, ctx.householdId)));
});
route("POST", "/properties", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const [prop] = await ctx.db.insert(properties).values({
    household_id: ctx.householdId, name: p.name, address_label: p.address_label ?? null, ownership_share_bp: p.ownership_share_bp ?? 10000,
    market_value_cents: p.market_value_cents ?? 0, valuation_date: p.valuation_date ?? null, outstanding_bond_cents: p.outstanding_bond_cents ?? 0,
    bond_account_id: p.bond_account_id ?? null, rental_status: p.rental_status ?? "rented", notes: p.notes ?? null,
  }).returning();
  return json(prop, 201);
});
route("POST", "/properties/:id/cash-flows", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  await getScoped(ctx.db.select().from(properties).where(eq(properties.id, Number(params.id))), ctx.householdId, "Property");
  const p = await body(req);
  const [cf] = await ctx.db.insert(propertyCashFlows).values({ property_id: Number(params.id), ...p }).returning();
  return json(cf, 201);
});
route("GET", "/properties/:id/cash-flow", async (req, params) => {
  const ctx = await requireAuth(req);
  const prop = await getScoped(ctx.db.select().from(properties).where(eq(properties.id, Number(params.id))), ctx.householdId, "Property");
  const latest = (await ctx.db.select().from(propertyCashFlows).where(eq(propertyCashFlows.property_id, prop.id)).orderBy(desc(propertyCashFlows.id)).limit(1)).at(0);
  if (!latest) return json({ property_id: prop.id, has_data: false });
  const m = calc.propertyMetrics(latest, prop.market_value_cents, prop.outstanding_bond_cents);
  return json({ property_id: prop.id, has_data: true, name: prop.name, ...m });
});
route("GET", "/properties-summary", async (req) => {
  const ctx = await requireAuth(req);
  const props = await ctx.db.select().from(properties).where(eq(properties.household_id, ctx.householdId));
  let total = 0;
  const per: any[] = [];
  for (const prop of props) {
    const latest = (await ctx.db.select().from(propertyCashFlows).where(eq(propertyCashFlows.property_id, prop.id)).orderBy(desc(propertyCashFlows.id)).limit(1)).at(0);
    if (!latest) continue;
    const flow = calc.propertyCashFlow(latest);
    total += flow.surplus_shortfall_cents;
    per.push({ property_id: prop.id, name: prop.name, ...flow });
  }
  return json({ total_monthly_surplus_cents: total, properties: per });
});

// ── Goals ───────────────────────────────────────────────────────────────────
route("GET", "/goals", async (req) => {
  const ctx = await requireAuth(req);
  return json((await ctx.db.select().from(goals).where(eq(goals.household_id, ctx.householdId))).map(enrichGoal));
});
route("POST", "/goals", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const [g] = await ctx.db.insert(goals).values({
    household_id: ctx.householdId, name: p.name, goal_type: p.goal_type ?? null, target_amount_cents: p.target_amount_cents ?? 0,
    current_amount_cents: p.current_amount_cents ?? 0, target_date: p.target_date ?? null, monthly_contribution_cents: p.monthly_contribution_cents ?? 0,
    owner_member_id: p.owner_member_id ?? null, priority: p.priority ?? 3, linked_account_id: p.linked_account_id ?? null, notes: p.notes ?? null,
  }).returning();
  return json(enrichGoal(g), 201);
});
route("PATCH", "/goals/:id", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const g = await getScoped(ctx.db.select().from(goals).where(eq(goals.id, Number(params.id))), ctx.householdId, "Goal");
  await ctx.db.update(goals).set(await body(req)).where(eq(goals.id, g.id));
  return json(enrichGoal((await ctx.db.select().from(goals).where(eq(goals.id, g.id))).at(0)!));
});

// ── Scenarios ─────────────────────────────────────────────────────────────────
route("GET", "/scenarios", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(scenarios).where(eq(scenarios.household_id, ctx.householdId)));
});
route("POST", "/scenarios", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  const results = await runScenario(ctx.db, ctx.householdId, p.base_period_id ?? null, p.assumptions_json ?? {});
  const [s] = await ctx.db.insert(scenarios).values({
    household_id: ctx.householdId, name: p.name, base_period_id: p.base_period_id ?? null, description: p.description ?? null,
    assumptions_json: p.assumptions_json ?? {}, projected_results_json: results as any, created_by_id: ctx.userId,
  }).returning();
  return json(s, 201);
});
route("POST", "/scenarios/:id/run", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const s = await getScoped(ctx.db.select().from(scenarios).where(eq(scenarios.id, Number(params.id))), ctx.householdId, "Scenario");
  const results = await runScenario(ctx.db, ctx.householdId, s.base_period_id ?? null, (s.assumptions_json ?? {}) as any);
  await ctx.db.update(scenarios).set({ projected_results_json: results as any }).where(eq(scenarios.id, s.id));
  return json((await ctx.db.select().from(scenarios).where(eq(scenarios.id, s.id))).at(0));
});
route("GET", "/scenarios/:id/compare", async (req, params) => {
  const ctx = await requireAuth(req);
  const s = await getScoped(ctx.db.select().from(scenarios).where(eq(scenarios.id, Number(params.id))), ctx.householdId, "Scenario");
  return json(s.projected_results_json ?? (await runScenario(ctx.db, ctx.householdId, s.base_period_id ?? null, (s.assumptions_json ?? {}) as any)));
});

// ── Dashboard / reports / insights / copilot ─────────────────────────────────
route("GET", "/dashboard", async (req) => {
  const ctx = await requireAuth(req);
  const period = await resolvePeriod(ctx, qp(req, "period_id"));
  if (!period) return json({ has_period: false, message: "Create a budget period to see your dashboard." });
  const lines = await loadLinesForCalc(ctx.db, ctx.householdId, period.id);
  const summary = calc.periodSummary(lines);
  const members = new Map((await ctx.db.select().from(householdMembers).where(eq(householdMembers.household_id, ctx.householdId))).map((m) => [m.id, m.name]));
  const owner_cards = Object.entries(summary.owner_positions).map(([mid, v]) => ({ member_id: Number(mid), member_name: members.get(Number(mid)) ?? "Unknown", ...v }));
  const accRows = await ctx.db.select().from(accounts).where(eq(accounts.household_id, ctx.householdId));
  const net_worth_cents = calc.netWorth(
    accRows.filter((a) => !LIABILITY_TYPES.has(a.type)).map((a) => a.current_balance_cents),
    accRows.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.current_balance_cents),
  );
  const hh = (await ctx.db.select().from(households).where(eq(households.id, ctx.householdId))).at(0);
  return json({
    has_period: true,
    period: { id: period.id, label: period.label, status: period.status, start_date: period.start_date, end_date: period.end_date },
    summary, owner_cards, net_worth_cents, currency: hh?.base_currency ?? "ZAR",
  });
});
route("GET", "/reports/monthly", async (req) => {
  const ctx = await requireAuth(req);
  const period = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(qp(req, "period_id")))), ctx.householdId, "Budget period");
  const lines = await loadLinesForCalc(ctx.db, ctx.householdId, period.id);
  return json({ period: { id: period.id, label: period.label, status: period.status }, summary: calc.periodSummary(lines) });
});
route("GET", "/reports/trends", async (req) => {
  const ctx = await requireAuth(req);
  const periods = await ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.household_id, ctx.householdId)).orderBy(budgetPeriods.start_date);
  const series = [];
  for (const p of periods.slice(-12)) {
    const s = calc.periodSummary(await loadLinesForCalc(ctx.db, ctx.householdId, p.id)).planned;
    series.push({ period_id: p.id, label: p.label, income_cents: s.total_income_cents, expenses_cents: s.total_expenses_cents, net_cents: s.net_position_cents, savings_cents: s.total_savings_cents, savings_rate: s.savings_rate });
  }
  return json({ series });
});
route("GET", "/reports/cash-flow", async (req) => {
  const ctx = await requireAuth(req);
  const period = await resolvePeriod(ctx, qp(req, "period_id"));
  if (!period) return json({ has_period: false });
  const months = Math.min(Math.max(Number(qp(req, "months")) || 12, 1), 24);
  return json(await cashFlowForecast(ctx.db, ctx.householdId, period.id, months));
});
route("GET", "/insights", async (req) => {
  const ctx = await requireAuth(req);
  return json(await ctx.db.select().from(insights).where(and(eq(insights.household_id, ctx.householdId))).orderBy(desc(insights.created_at)));
});
route("POST", "/insights/generate/:periodId", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const period = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.periodId))), ctx.householdId, "Budget period");
  const found = await generatePeriodInsights(ctx.db, ctx.householdId, period.id);
  const created = [];
  for (const item of found) {
    const [ins] = await ctx.db.insert(insights).values({
      household_id: ctx.householdId, period_id: period.id, type: item.type, severity: item.severity, summary: item.summary, explanation: item.explanation, action: item.action, evidence_json: item.evidence,
    }).returning();
    created.push(ins);
  }
  return json(created);
});
route("PATCH", "/insights/:id/status", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const ins = await getScoped(ctx.db.select().from(insights).where(eq(insights.id, Number(params.id))), ctx.householdId, "Insight");
  await ctx.db.update(insights).set({ status: qp(req, "new_status") ?? ins.status }).where(eq(insights.id, ins.id));
  return json((await ctx.db.select().from(insights).where(eq(insights.id, ins.id))).at(0));
});
route("POST", "/copilot/ask", async (req) => {
  const ctx = await requireAuth(req);
  const p = await body(req);
  const period = await resolvePeriod(ctx, p.period_id != null ? String(p.period_id) : null);
  return json(await copilotAnswer(getEnv(), ctx.db, ctx.householdId, p.question ?? "", period ? period.id : null));
});

// ── Import ────────────────────────────────────────────────────────────────────
route("POST", "/import/workbook/analyze", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const form = await req.formData();
  const file = form.get("file") as File;
  return json(analyzeWorkbook(await file.arrayBuffer()));
});
route("POST", "/import/workbook", async (req) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const form = await req.formData();
  const file = form.get("file") as File;
  return json(await importWorkbook(ctx.db, ctx.householdId, await file.arrayBuffer(), ctx.userId));
});

// ── Payment tracking / settlement ─────────────────────────────────────────────
route("GET", "/budget-periods/:id/settlement", async (req, params) => {
  const ctx = await requireAuth(req);
  const period = await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  return json(await periodSettlement(ctx.db, ctx.householdId, period.id));
});
route("GET", "/reports/outstanding", async (req) => {
  const ctx = await requireAuth(req);
  const period = await resolvePeriod(ctx, qp(req, "period_id"));
  if (!period) return json({ has_period: false });
  return json({ has_period: true, ...(await periodSettlement(ctx.db, ctx.householdId, period.id)) });
});
route("POST", "/budget-lines/:id/payments", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  return json(await addPayment(ctx.db, ctx.householdId, ctx.userId, Number(params.id), await body(req)), 201);
});
route("GET", "/budget-lines/:id/payments", async (req, params) => {
  const ctx = await requireAuth(req);
  return json(await paymentHistory(ctx.db, ctx.householdId, Number(params.id)));
});
route("POST", "/budget-lines/:id/mark-paid", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  return json(await markPaidInFull(ctx.db, ctx.householdId, ctx.userId, Number(params.id), await body(req)), 201);
});
route("POST", "/budget-periods/:id/bulk-mark-paid", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  await getScoped(ctx.db.select().from(budgetPeriods).where(eq(budgetPeriods.id, Number(params.id))), ctx.householdId, "Budget period");
  const p = await body(req);
  const ids: number[] = Array.isArray(p.line_ids) ? p.line_ids.map(Number) : [];
  if (!ids.length) throw new HttpError(422, "No lines selected");
  const { line_ids, ...rest } = p;
  return json(await bulkMarkPaid(ctx.db, ctx.householdId, ctx.userId, ids, rest), 201);
});
route("PATCH", "/payments/:id", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  return json(await editPayment(ctx.db, ctx.householdId, ctx.userId, Number(params.id), await body(req)));
});
route("POST", "/payments/:id/reverse", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const p = await body(req);
  return json(await reversePayment(ctx.db, ctx.householdId, ctx.userId, Number(params.id), p.reason));
});
route("DELETE", "/payments/:id", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  return json(await softDeletePayment(ctx.db, ctx.householdId, ctx.userId, Number(params.id)));
});
route("PATCH", "/budget-lines/:id/payment-config", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const line = await getScoped(ctx.db.select().from(budgetLines).where(eq(budgetLines.id, Number(params.id))), ctx.householdId, "Line");
  const p = await body(req);
  const allowed: any = {};
  for (const k of ["due_date", "responsible_member_id", "source_account_id", "is_debit_order", "is_manual_payment", "requires_confirmation", "manual_status", "priority"])
    if (k in p) allowed[k] = p[k];
  // payment_type is the source of truth — derive the settlement booleans from it.
  if ("payment_type" in p) { allowed.payment_type = p.payment_type; Object.assign(allowed, derivePaymentFlags(p.payment_type)); }
  await ctx.db.update(budgetLines).set(allowed).where(eq(budgetLines.id, line.id));
  await recordAudit(ctx.db, { action: "payment.config_changed", entity_type: "budget_line", entity_id: line.id, household_id: ctx.householdId, actor_user_id: ctx.userId, detail: allowed });
  return json((await ctx.db.select().from(budgetLines).where(eq(budgetLines.id, line.id))).at(0));
});
route("GET", "/budget-lines/:id/comments", async (req, params) => {
  const ctx = await requireAuth(req);
  const line = await getScoped(ctx.db.select().from(budgetLines).where(eq(budgetLines.id, Number(params.id))), ctx.householdId, "Line");
  return json(await ctx.db.select().from(expenseComments).where(eq(expenseComments.budget_line_id, line.id)).orderBy(desc(expenseComments.created_at)));
});
route("POST", "/budget-lines/:id/comments", async (req, params) => {
  const ctx = await requireAuth(req); requireWrite(ctx);
  const line = await getScoped(ctx.db.select().from(budgetLines).where(eq(budgetLines.id, Number(params.id))), ctx.householdId, "Line");
  const p = await body(req);
  const [c] = await ctx.db.insert(expenseComments).values({
    budget_line_id: line.id, household_id: ctx.householdId, comment_text: p.comment_text,
    comment_type: p.comment_type ?? "note", created_by: ctx.userId,
  }).returning();
  await recordAudit(ctx.db, { action: "comment.added", entity_type: "budget_line", entity_id: line.id, household_id: ctx.householdId, actor_user_id: ctx.userId, detail: { comment_id: c.id } });
  return json(c, 201);
});

// ── Health ────────────────────────────────────────────────────────────────────
route("GET", "/health", async () => json({ status: "ok", formula_version: calc.FORMULA_VERSION }));

// ── Dispatch ──────────────────────────────────────────────────────────────────
export async function dispatch(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    let path = url.pathname.replace(/^\/api/, "");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    for (const [method, rx, names, handler] of routes) {
      if (method !== req.method) continue;
      const m = path.match(rx);
      if (!m) continue;
      const params: Record<string, string> = {};
      names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      return await handler(req, params);
    }
    return json({ detail: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
