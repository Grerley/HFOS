import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export interface Env {
  DB: D1Database;
  HFOS_SECRET_KEY?: string;
  HFOS_ENCRYPTION_KEY?: string;
  // Set to "1" to FAIL CLOSED when HFOS_SECRET_KEY is missing/weak (recommended
  // for production once the real secret is confirmed set).
  HFOS_ENFORCE_SECRET?: string;
  // Escape hatch for LOCAL DEV ONLY: set to "1" to silence the insecure-key
  // warning when HFOS_SECRET_KEY is absent. Never set this in production.
  HFOS_ALLOW_INSECURE_SECRET?: string;
  // Gate the hidden copilot "/diag" introspection command (off unless "1").
  HFOS_DIAG_ENABLED?: string;
  // Optional Cloudflare Turnstile secret; when set, register/login require a token.
  TURNSTILE_SECRET_KEY?: string;
  // Copilot LLM provider: "workers-ai" (native, free), "ai-gateway" (Claude via
  // Cloudflare AI Gateway + Unified Billing, no key), "anthropic" (direct API,
  // needs ANTHROPIC_API_KEY), or "rules" (deterministic, no LLM).
  HFOS_COPILOT_PROVIDER?: string;
  // Optional override for the provider's model id (e.g. "anthropic/claude-sonnet-4.5"
  // for ai-gateway, "@cf/…" for workers-ai, "claude-sonnet-5" for anthropic).
  HFOS_COPILOT_MODEL?: string;
  // AI Gateway name for the "ai-gateway" provider (defaults to "default").
  HFOS_AI_GATEWAY_ID?: string;
  // Workers AI binding (native, no secret), present when [ai] is bound in wrangler.
  // Also the transport for the "ai-gateway" provider (routes third-party models).
  AI?: unknown;
  // Optional direct-Anthropic provider; set as an encrypted secret to enable.
  ANTHROPIC_API_KEY?: string;
  // Telegram copilot bot (optional; disabled until the token + webhook secret are set).
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string; // non-secret; only used to build a t.me deep link
  // Transactional email (password reset, invites). Both optional, so email stays
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

const INSECURE_FALLBACK_SECRET = "dev-only-change-me-please-generate-a-real-secret";

/**
 * The JWT signing secret.
 *
 * A strong HFOS_SECRET_KEY (16+ chars, not the placeholder) is always used when
 * present. When it is absent/weak we can either fail CLOSED (refuse to sign, the
 * secure default) or fall back to a publicly-known key (INSECURE — anyone could
 * forge a login). Enforcement is gated so it can be switched on only once the
 * production secret is confirmed set, without risking a lock-out:
 *   - HFOS_ENFORCE_SECRET=1  -> fail closed (recommended for production)
 *   - otherwise              -> serve with the insecure fallback but warn loudly
 * Local dev may set HFOS_ALLOW_INSECURE_SECRET=1 to silence the warning.
 */
export function secret(env: Env): string {
  const s = env.HFOS_SECRET_KEY;
  if (s && s !== INSECURE_FALLBACK_SECRET && s.length >= 16) return s;
  if (env.HFOS_ENFORCE_SECRET === "1") {
    throw new Error("HFOS_SECRET_KEY is missing or insecure. Set a strong random secret (16+ chars).");
  }
  if (env.HFOS_ALLOW_INSECURE_SECRET !== "1") {
    console.warn("SECURITY: HFOS_SECRET_KEY is not a strong value; using an INSECURE signing key. Set it and HFOS_ENFORCE_SECRET=1 before real users.");
  }
  return INSECURE_FALLBACK_SECRET;
}
