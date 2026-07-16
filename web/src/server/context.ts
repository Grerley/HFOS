/** Request context: JSON helpers, auth resolution and RBAC (data-layer enforced). */
import { and, eq } from "drizzle-orm";
import { getDb, getEnv, secret, type DB, type Env } from "../db/client";
import { memberships, users } from "../db/schema";
import { verifyAccessToken } from "../lib/auth";
import { ADMIN_ROLES, WRITE_ROLES } from "../lib/enums";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ detail: e.message }, e.status);
  console.error(e);
  return json({ detail: "Internal server error" }, 500);
}

export interface Ctx {
  db: DB;
  env: Env;
  userId: number;
  householdId: number;
  role: string;
}

/** Resolve the authenticated user and active household from request headers. */
export async function requireAuth(req: Request): Promise<Ctx> {
  const env = getEnv();
  const db = getDb(env);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new HttpError(401, "Not authenticated");
  const sub = await verifyAccessToken(token, secret(env));
  if (!sub) throw new HttpError(401, "Invalid or expired token");
  const userId = Number(sub);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !user.is_active) throw new HttpError(401, "User not found or inactive");

  const rows = await db.select().from(memberships).where(eq(memberships.user_id, userId));
  if (rows.length === 0) throw new HttpError(403, "User has no household membership");

  const requested = req.headers.get("x-household-id");
  let membership = rows[0];
  if (requested) {
    const match = rows.find((m) => m.household_id === Number(requested));
    if (!match) throw new HttpError(403, "No access to that household");
    membership = match;
  }
  return { db, env, userId, householdId: membership.household_id, role: membership.role };
}

export function requireWrite(ctx: Ctx): void {
  if (!WRITE_ROLES.has(ctx.role))
    throw new HttpError(403, `Role '${ctx.role}' cannot modify financial data`);
}

export function requireAdmin(ctx: Ctx): void {
  if (!ADMIN_ROLES.has(ctx.role))
    throw new HttpError(403, `Role '${ctx.role}' cannot administer this household`);
}

/** Assert a row exists and belongs to the active household. */
export function scoped<T extends { household_id?: number | null }>(
  row: T | undefined | null,
  householdId: number,
  label = "Resource",
): T {
  if (!row || row.household_id !== householdId) throw new HttpError(404, `${label} not found`);
  return row;
}
