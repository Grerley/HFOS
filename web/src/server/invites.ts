/**
 * Signed-link household invitations. An admin creates an invite (no password);
 * the invitee receives an emailed link and sets their own password on accept.
 * Only the token hash is stored; tokens are single-use and expire in 7 days.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { households, householdMembers, invites, memberships, users } from "../db/schema";
import { contentHash, hashPassword } from "../lib/hash";
import { validatePassword } from "../lib/password";
import { HttpError } from "./context";

const INVITE_TTL_SEC = 7 * 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function createInvite(
  db: DB,
  householdId: number,
  invitedBy: number,
  p: { name?: string; email: string; role?: string; relationship_label?: string },
) {
  const email = (p.email ?? "").trim();
  if (!email) throw new HttpError(422, "An email address is required to invite someone.");
  const role = p.role ?? "partner";

  const existingUser = (await db.select().from(users).where(eq(users.email, email))).at(0);
  if (existingUser) {
    const m = await db.select().from(memberships)
      .where(and(eq(memberships.user_id, existingUser.id), eq(memberships.household_id, householdId)));
    if (m.length) throw new HttpError(409, "That person is already a member of this household.");
  }

  // A pending member row so they appear in the member list immediately.
  const [member] = await db.insert(householdMembers).values({
    household_id: householdId, user_id: null, name: p.name ?? email, role,
    relationship_label: p.relationship_label ?? "partner",
  }).returning();

  const token = randomToken();
  const [inv] = await db.insert(invites).values({
    household_id: householdId, email, name: p.name ?? null, role,
    token_hash: await contentHash(token), invited_by: invitedBy, member_id: member.id,
    expires_at: nowSec() + INVITE_TTL_SEC,
  }).returning();

  return { invite: inv, member, token };
}

export async function getInviteByToken(db: DB, token: string) {
  if (!token) return null;
  const inv = (await db.select().from(invites).where(eq(invites.token_hash, await contentHash(token)))).at(0);
  if (!inv) return null;
  const hh = (await db.select().from(households).where(eq(households.id, inv.household_id))).at(0);
  const inviter = inv.invited_by ? (await db.select().from(users).where(eq(users.id, inv.invited_by))).at(0) : null;
  const hasAccount = !!(await db.select().from(users).where(eq(users.email, inv.email))).at(0);
  const expired = inv.expires_at < nowSec();
  const accepted = !!inv.accepted_at;
  return {
    valid: !expired && !accepted,
    expired,
    accepted,
    has_account: hasAccount,
    household_name: hh?.name ?? "a household",
    inviter_name: inviter?.name ?? null,
    email: inv.email,
    name: inv.name,
    role: inv.role,
    _inv: inv,
  };
}

/** Accept an invite. New users set a password (auto-login); existing users are just linked. */
export async function acceptInvite(db: DB, token: string, p: { name?: string; password?: string }) {
  const info = await getInviteByToken(db, token);
  if (!info) throw new HttpError(404, "This invite link is invalid.");
  const inv = info._inv;
  if (inv.accepted_at) throw new HttpError(409, "This invite has already been accepted.");
  if (inv.expires_at < nowSec()) throw new HttpError(410, "This invite has expired — please ask for a new one.");

  let user = (await db.select().from(users).where(eq(users.email, inv.email))).at(0);
  const created = !user;
  if (!user) {
    const pwError = validatePassword(p.password ?? "", inv.email);
    if (pwError) throw new HttpError(422, pwError);
    [user] = await db.insert(users).values({
      name: (p.name || inv.name || inv.email).trim(),
      email: inv.email,
      password_hash: await hashPassword(p.password!),
    }).returning();
  }

  const existingMembership = await db.select().from(memberships)
    .where(and(eq(memberships.user_id, user.id), eq(memberships.household_id, inv.household_id)));
  if (!existingMembership.length) {
    await db.insert(memberships).values({ user_id: user.id, household_id: inv.household_id, role: inv.role });
  }
  if (inv.member_id) {
    await db.update(householdMembers).set({ user_id: user.id }).where(eq(householdMembers.id, inv.member_id));
  }
  await db.update(invites).set({ accepted_at: sql`(unixepoch())` }).where(eq(invites.id, inv.id));

  return { user, created, householdId: inv.household_id };
}
