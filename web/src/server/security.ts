/**
 * Auth abuse protection: login/register rate-limiting and lockout, backed by the
 * auth_attempts table in D1 (no extra bindings/secrets). Thresholds are per-email
 * and per-IP over a sliding window; a successful login clears that email's failures.
 */
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { authAttempts } from "../db/schema";

// Login: lock an email after this many failures within the window; also cap total
// attempts from one IP to blunt distributed guessing.
const LOGIN_WINDOW_SEC = 15 * 60;
const EMAIL_MAX_FAILURES = 5;
const IP_MAX_ATTEMPTS = 30;

// Register: cap new accounts per IP to stop mass sign-ups.
const REGISTER_WINDOW_SEC = 60 * 60;
const REGISTER_IP_MAX = 8;

export function clientIp(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

async function countWhere(db: DB, whereSql: ReturnType<typeof sql>): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(authAttempts)
    .where(whereSql);
  return Number(rows[0]?.c ?? 0);
}

export interface RateVerdict {
  limited: boolean;
  retryAfterSec: number;
  reason?: "email" | "ip";
}

/** Check whether this login should be blocked before verifying the password. */
export async function checkLoginRateLimit(db: DB, emailKey: string, ip: string): Promise<RateVerdict> {
  const emailFails = emailKey
    ? await countWhere(
        db,
        sql`email = ${emailKey} AND outcome != 'success' AND kind = 'login' AND created_at > (unixepoch() - ${LOGIN_WINDOW_SEC})`,
      )
    : 0;
  if (emailFails >= EMAIL_MAX_FAILURES) return { limited: true, retryAfterSec: LOGIN_WINDOW_SEC, reason: "email" };

  const ipAttempts = await countWhere(
    db,
    sql`ip = ${ip} AND kind = 'login' AND created_at > (unixepoch() - ${LOGIN_WINDOW_SEC})`,
  );
  if (ipAttempts >= IP_MAX_ATTEMPTS) return { limited: true, retryAfterSec: LOGIN_WINDOW_SEC, reason: "ip" };

  return { limited: false, retryAfterSec: 0 };
}

export async function checkRegisterRateLimit(db: DB, ip: string): Promise<RateVerdict> {
  const count = await countWhere(
    db,
    sql`ip = ${ip} AND kind = 'register' AND created_at > (unixepoch() - ${REGISTER_WINDOW_SEC})`,
  );
  if (count >= REGISTER_IP_MAX) return { limited: true, retryAfterSec: REGISTER_WINDOW_SEC, reason: "ip" };
  return { limited: false, retryAfterSec: 0 };
}

export async function recordAttempt(
  db: DB,
  kind: "login" | "register",
  emailKey: string,
  ip: string,
  outcome: "success" | "bad_password" | "no_user" | "rate_limited",
): Promise<void> {
  await db.insert(authAttempts).values({ email: emailKey || null, ip, kind, outcome });
}

/** Clear an email's recent failures after a successful login so it isn't over-counted. */
export async function clearLoginFailures(db: DB, emailKey: string): Promise<void> {
  if (!emailKey) return;
  await db.delete(authAttempts).where(sql`email = ${emailKey} AND kind = 'login' AND outcome != 'success'`);
}
