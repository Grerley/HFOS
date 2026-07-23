import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export interface Env {
  DB: D1Database;
  HFOS_SECRET_KEY?: string;
  HFOS_ENCRYPTION_KEY?: string;
  // Copilot LLM provider: "workers-ai" (native, free), "ai-gateway" (Claude via
  // Cloudflare AI Gateway + Unified Billing — no key), "anthropic" (direct API,
  // needs ANTHROPIC_API_KEY), or "rules" (deterministic, no LLM).
  HFOS_COPILOT_PROVIDER?: string;
  // Optional override for the provider's model id (e.g. "anthropic/claude-sonnet-4.5"
  // for ai-gateway, "@cf/…" for workers-ai, "claude-sonnet-5" for anthropic).
  HFOS_COPILOT_MODEL?: string;
  // AI Gateway name for the "ai-gateway" provider (defaults to "default").
  HFOS_AI_GATEWAY_ID?: string;
  // Workers AI binding (native, no secret) — present when [ai] is bound in wrangler.
  // Also the transport for the "ai-gateway" provider (routes third-party models).
  AI?: unknown;
  // Optional direct-Anthropic provider; set as an encrypted secret to enable.
  ANTHROPIC_API_KEY?: string;
  // Telegram copilot bot (optional; disabled until the token + webhook secret are set).
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string; // non-secret; only used to build a t.me deep link
  // Transactional email (password reset, invites). Both optional — email stays
  // disabled until RESEND_API_KEY is set. EMAIL_FROM is a non-secret [vars] value.
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // Shared secret authorizing the scheduled reminders endpoint. Reminders are
  // disabled until this is set.
  CRON_SECRET?: string;
  // WhatsApp notifications (optional; disabled until a provider is configured).
  WHATSAPP_PROVIDER?: string; // "meta" | "twilio"
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  WHATSAPP_TEMPLATE?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
}

export type DB = DrizzleD1Database<typeof schema>;

export function getEnv(): Env {
  return getCloudflareContext().env as unknown as Env;
}

export function getDb(env: Env): DB {
  return drizzle(env.DB, { schema });
}

export function secret(env: Env): string {
  return env.HFOS_SECRET_KEY || "dev-only-change-me-please-generate-a-real-secret";
}
