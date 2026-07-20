/**
 * WhatsApp notification layer (provider-agnostic). Only this file knows about a
 * provider. Selected by WHATSAPP_PROVIDER: "meta" (WhatsApp Cloud API) or
 * "twilio". Disabled (graceful no-op) until credentials are set, exactly like
 * the email layer.
 *
 * Config:
 *   WHATSAPP_PROVIDER      "meta" | "twilio"
 *   Meta:   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, optional WHATSAPP_TEMPLATE (+ WHATSAPP_TEMPLATE_LANG)
 *   Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g. "whatsapp:+14155238886")
 *
 * NOTE ON TEMPLATES: business-initiated WhatsApp messages (reminders) must use a
 * pre-approved template outside the 24-hour service window. When WHATSAPP_TEMPLATE
 * is set, the Meta sender sends that template with the body text as its parameter;
 * otherwise it sends plain text (works for testing / within an open session).
 */
import type { Env } from "../db/client";

export interface WhatsAppResult {
  sent: boolean;
  reason?: string;
}

export interface WhatsAppMessage {
  // Plain-text body (Twilio, and Meta when no template is configured).
  text: string;
  // Ordered body parameters for the approved Meta template ({{1}}, {{2}}, …).
  // Must be single-line (no newlines / tabs / 4+ spaces) per WhatsApp rules.
  params?: string[];
}

function provider(env: Env): "meta" | "twilio" | null {
  const p = ((env as any).WHATSAPP_PROVIDER || "").toLowerCase();
  if (p === "meta" && (env as any).WHATSAPP_TOKEN && (env as any).WHATSAPP_PHONE_ID) return "meta";
  if (p === "twilio" && (env as any).TWILIO_ACCOUNT_SID && (env as any).TWILIO_AUTH_TOKEN && (env as any).TWILIO_WHATSAPP_FROM) return "twilio";
  return null;
}

export function whatsappConfigured(env: Env): boolean {
  return provider(env) !== null;
}

/** Normalise a phone number to E.164-ish digits (strip spaces, dashes, parens). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  return /^\+?\d{7,15}$/.test(cleaned) ? cleaned : null;
}

// Single-line-safe parameter for a WhatsApp template (no newlines/tabs/4+ spaces).
function safeParam(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1000);
}

async function sendMeta(env: Env, to: string, msg: WhatsAppMessage): Promise<WhatsAppResult> {
  const token = (env as any).WHATSAPP_TOKEN as string;
  const phoneId = (env as any).WHATSAPP_PHONE_ID as string;
  const template = (env as any).WHATSAPP_TEMPLATE as string | undefined;
  const lang = (env as any).WHATSAPP_TEMPLATE_LANG || "en";
  const parameters = (msg.params ?? [msg.text]).map((t) => ({ type: "text", text: safeParam(t) }));
  const payload = template
    ? {
        messaging_product: "whatsapp", to, type: "template",
        template: { name: template, language: { code: lang }, components: [{ type: "body", parameters }] },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: msg.text } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? { sent: true } : { sent: false, reason: `meta_${res.status}` };
}

async function sendTwilio(env: Env, to: string, msg: WhatsAppMessage): Promise<WhatsAppResult> {
  const sid = (env as any).TWILIO_ACCOUNT_SID as string;
  const token = (env as any).TWILIO_AUTH_TOKEN as string;
  const from = (env as any).TWILIO_WHATSAPP_FROM as string; // "whatsapp:+1..."
  const form = new URLSearchParams({ To: `whatsapp:${to}`, From: from, Body: msg.text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${sid}:${token}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return res.ok ? { sent: true } : { sent: false, reason: `twilio_${res.status}` };
}

export async function sendWhatsApp(env: Env, to: string, msg: WhatsAppMessage): Promise<WhatsAppResult> {
  const p = provider(env);
  if (!p) return { sent: false, reason: "whatsapp_not_configured" };
  const num = normalizePhone(to);
  if (!num) return { sent: false, reason: "invalid_number" };
  try {
    return p === "meta" ? await sendMeta(env, num, msg) : await sendTwilio(env, num, msg);
  } catch {
    return { sent: false, reason: "whatsapp_send_failed" };
  }
}
