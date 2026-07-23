/**
 * Telegram bot layer. The copilot brain is channel-agnostic; this module is the
 * only place that knows about Telegram. It:
 *   - sends messages via the Bot API (graceful no-op until TELEGRAM_BOT_TOKEN is set),
 *   - verifies inbound webhook calls with a shared secret header,
 *   - links a Telegram chat to an HFOS user + household via a one-time code, and
 *   - answers free-form questions by resolving the chat's household + latest
 *     period and calling the same grounded copilot the web app uses.
 *
 * Config:
 *   TELEGRAM_BOT_TOKEN      bot token from @BotFather (secret)
 *   TELEGRAM_WEBHOOK_SECRET shared secret; Telegram echoes it in the
 *                           X-Telegram-Bot-Api-Secret-Token header (secret)
 *   TELEGRAM_BOT_USERNAME   optional; used only to build a t.me deep link
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB, Env } from "../db/client";
import { budgetPeriods, telegramLinkCodes, telegramLinks } from "../db/schema";
import { contentHash } from "../lib/hash";
import { copilotAnswer } from "./copilot";

const CODE_TTL_SEC = 15 * 60; // 15 minutes
// Unambiguous alphabet (no 0/O/1/I) for a short, human-typeable code.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const API_TIMEOUT_MS = 8000;

export function telegramConfigured(env: Env): boolean {
  return !!(env as any).TELEGRAM_BOT_TOKEN;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("telegram_timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Send a plain-text message. Best-effort: never throws. */
export async function sendTelegram(env: Env, chatId: string | number, text: string): Promise<boolean> {
  const token = (env as any).TELEGRAM_BOT_TOKEN as string | undefined;
  if (!token) return false;
  try {
    const res = await withTimeout(
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No parse_mode → plain text, so we never have to escape copilot output.
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }),
      }),
      API_TIMEOUT_MS,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Constant-shape webhook auth: Telegram echoes our secret in a header. */
export function verifyTelegramWebhook(req: Request, env: Env): boolean {
  const expected = (env as any).TELEGRAM_WEBHOOK_SECRET as string | undefined;
  if (!expected) return false;
  return req.headers.get("x-telegram-bot-api-secret-token") === expected;
}

function randomCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/**
 * Create a one-time link code for a user+household. Only the hash is stored.
 * Returns the raw code (shown once in the web app). Prior unused codes for the
 * same user are invalidated.
 */
export async function createTelegramLinkCode(db: DB, userId: number, householdId: number): Promise<{ code: string; expires_at: number }> {
  await db.update(telegramLinkCodes)
    .set({ used_at: sql`(unixepoch())` })
    .where(and(eq(telegramLinkCodes.user_id, userId), isNull(telegramLinkCodes.used_at)));
  const code = randomCode();
  const expires_at = Math.floor(Date.now() / 1000) + CODE_TTL_SEC;
  await db.insert(telegramLinkCodes).values({
    code_hash: await contentHash(code.toUpperCase()),
    user_id: userId,
    household_id: householdId,
    expires_at,
  });
  return { code, expires_at };
}

/** Is this user's household already linked to a Telegram chat? */
export async function telegramLinkStatus(db: DB, householdId: number) {
  const row = (await db.select().from(telegramLinks).where(eq(telegramLinks.household_id, householdId))).at(0);
  return { linked: !!row, username: row?.telegram_username ?? null };
}

/** Remove any Telegram binding for a household. */
export async function unlinkTelegramForHousehold(db: DB, householdId: number): Promise<void> {
  await db.delete(telegramLinks).where(eq(telegramLinks.household_id, householdId));
}

/** Redeem a raw code and bind a chat. One binding per chat (replaces any prior). */
async function linkChat(db: DB, rawCode: string, chatId: string, fromId: string | null, username: string | null) {
  const code_hash = await contentHash(rawCode.trim().toUpperCase());
  const row = (await db.select().from(telegramLinkCodes).where(eq(telegramLinkCodes.code_hash, code_hash))).at(0);
  if (!row) return { ok: false as const, reason: "invalid" as const };
  if (row.used_at) return { ok: false as const, reason: "used" as const };
  if (row.expires_at < Math.floor(Date.now() / 1000)) return { ok: false as const, reason: "expired" as const };

  await db.delete(telegramLinks).where(eq(telegramLinks.chat_id, chatId));
  await db.insert(telegramLinks).values({
    chat_id: chatId, telegram_user_id: fromId, telegram_username: username,
    user_id: row.user_id, household_id: row.household_id,
  });
  await db.update(telegramLinkCodes).set({ used_at: sql`(unixepoch())` }).where(eq(telegramLinkCodes.id, row.id));
  return { ok: true as const, householdId: row.household_id };
}

async function latestPeriodId(db: DB, householdId: number): Promise<number | null> {
  const p = (await db.select().from(budgetPeriods)
    .where(eq(budgetPeriods.household_id, householdId))
    .orderBy(desc(budgetPeriods.start_date)).limit(1)).at(0);
  return p?.id ?? null;
}

/** Split "/cmd arg rest" → { cmd, arg }. Pure; unit-tested. Non-commands → cmd null. */
export function parseCommand(text: string): { cmd: string | null; arg: string } {
  const t = text.trim();
  if (!t.startsWith("/")) return { cmd: null, arg: t };
  const sp = t.indexOf(" ");
  const head = (sp === -1 ? t : t.slice(0, sp)).slice(1).toLowerCase();
  const cmd = head.split("@")[0]; // strip @botname suffix used in groups
  const arg = sp === -1 ? "" : t.slice(sp + 1).trim();
  return { cmd, arg };
}

const HELP =
  "HFOS copilot commands:\n" +
  "/link <code> — connect this chat (get a code in the app: Settings → Connect Telegram)\n" +
  "/whoami — show what this chat is linked to\n" +
  "/unlink — disconnect this chat\n" +
  "/help — this message\n\n" +
  "Once linked, just ask a question, e.g. \"are we over budget this month?\"";

/**
 * Process one Telegram update. Always resolves (never throws) so the webhook can
 * return 200 and Telegram won't retry-storm us.
 */
export async function handleTelegramUpdate(env: Env, db: DB, update: any): Promise<void> {
  const msg = update?.message ?? update?.edited_message;
  const text: string | undefined = msg?.text;
  const chat = msg?.chat;
  if (!msg || !chat || typeof text !== "string") return;

  const chatId = String(chat.id);
  const fromId = msg.from?.id != null ? String(msg.from.id) : null;
  const username = msg.from?.username ?? null;

  try {
    const { cmd, arg } = parseCommand(text);

    // /start <code> is the t.me deep-link path; /start alone is a greeting.
    if (cmd === "start") {
      if (arg) return void (await respondLink(env, db, arg, chatId, fromId, username));
      await sendTelegram(env, chatId,
        "Welcome to your HFOS copilot. To connect this chat to your household, open the app → Settings → Connect Telegram, then send /link <code>.");
      return;
    }
    if (cmd === "link") {
      if (!arg) { await sendTelegram(env, chatId, "Send it as: /link <code> (get a code in the app under Settings → Connect Telegram)."); return; }
      return void (await respondLink(env, db, arg, chatId, fromId, username));
    }
    if (cmd === "help") { await sendTelegram(env, chatId, HELP); return; }
    if (cmd === "unlink") {
      await db.delete(telegramLinks).where(eq(telegramLinks.chat_id, chatId));
      await sendTelegram(env, chatId, "Disconnected. This chat can no longer see your finances. Send /link <code> to reconnect.");
      return;
    }

    const link = (await db.select().from(telegramLinks).where(eq(telegramLinks.chat_id, chatId))).at(0);
    if (cmd === "whoami") {
      await sendTelegram(env, chatId, link ? `Linked to household #${link.household_id}.` : "This chat isn't linked yet. Send /link <code>.");
      return;
    }
    if (cmd) { await sendTelegram(env, chatId, `Unknown command /${cmd}. ${HELP}`); return; }

    // Free-form question → grounded copilot answer.
    if (!link) {
      await sendTelegram(env, chatId, "This chat isn't linked to a household yet. Open the app → Settings → Connect Telegram to get a code, then send /link <code>.");
      return;
    }
    const periodId = await latestPeriodId(db, link.household_id);
    if (periodId == null) {
      await sendTelegram(env, chatId, "You don't have a budget period yet — create one in the app and I'll be able to answer questions about it.");
      return;
    }
    const result: any = await copilotAnswer(env, db, link.household_id, text, periodId);
    await sendTelegram(env, chatId, result?.answer || "I couldn't work that out just now — please try again.");
  } catch {
    await sendTelegram(env, chatId, "Something went wrong handling that. Please try again in a moment.");
  }
}

async function respondLink(env: Env, db: DB, code: string, chatId: string, fromId: string | null, username: string | null): Promise<void> {
  const r = await linkChat(db, code, chatId, fromId, username);
  if (r.ok) {
    await sendTelegram(env, chatId, "✅ Connected. Ask me anything about your budget, e.g. \"how's our savings rate this month?\"");
  } else {
    const why = r.reason === "expired" ? "that code has expired" : r.reason === "used" ? "that code was already used" : "that code isn't valid";
    await sendTelegram(env, chatId, `Sorry — ${why}. Generate a fresh one in the app under Settings → Connect Telegram.`);
  }
}
