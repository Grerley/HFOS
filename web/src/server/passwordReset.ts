/**
 * Password-reset tokens: create a single-use, 1-hour token (store only its hash),
 * and consume it to set a new password. No account enumeration — the caller
 * always responds the same whether or not the email exists.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { passwordResetTokens, users } from "../db/schema";
import { contentHash, hashPassword } from "../lib/hash";

const TOKEN_TTL_SEC = 60 * 60; // 1 hour

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create a reset token for a user and return the raw token (emailed to them). */
export async function createResetToken(db: DB, userId: number): Promise<string> {
  // Invalidate any outstanding tokens for this user first.
  await db.update(passwordResetTokens)
    .set({ used_at: sql`(unixepoch())` })
    .where(and(eq(passwordResetTokens.user_id, userId), isNull(passwordResetTokens.used_at)));
  const token = randomToken();
  const token_hash = await contentHash(token);
  await db.insert(passwordResetTokens).values({
    user_id: userId,
    token_hash,
    expires_at: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  });
  return token;
}

export interface ConsumeResult {
  ok: boolean;
  reason?: "invalid" | "expired" | "used";
  userId?: number;
}

/** Validate a raw token and set the new password hash; marks the token used. */
export async function consumeResetToken(db: DB, token: string, newPassword: string): Promise<ConsumeResult> {
  if (!token) return { ok: false, reason: "invalid" };
  const token_hash = await contentHash(token);
  const row = (await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token_hash, token_hash))).at(0);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (row.expires_at < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

  await db.update(users).set({ password_hash: await hashPassword(newPassword) }).where(eq(users.id, row.user_id));
  await db.update(passwordResetTokens).set({ used_at: sql`(unixepoch())` }).where(eq(passwordResetTokens.id, row.id));
  return { ok: true, userId: row.user_id };
}
