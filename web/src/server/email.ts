/**
 * Transactional email via Resend (https://resend.com) — a single REST call from
 * the Worker, no SDK. Provider-swappable: only this file knows about Resend.
 *
 * Config (all optional; email simply stays disabled until set):
 *   RESEND_API_KEY  — encrypted secret (synced from GitHub Actions).
 *   EMAIL_FROM      — e.g. "HFOS <noreply@yourdomain.com>" (a [vars] value).
 * A missing key returns {sent:false, reason:"email_not_configured"} so callers
 * (e.g. password reset) degrade gracefully instead of erroring.
 */
import type { Env } from "../db/client";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  sent: boolean;
  reason?: string;
}

export function emailConfigured(env: Env): boolean {
  return !!(env as any).RESEND_API_KEY;
}

export async function sendEmail(env: Env, msg: EmailMessage): Promise<EmailResult> {
  const key = (env as any).RESEND_API_KEY as string | undefined;
  const from = (env as any).EMAIL_FROM || "HFOS <onboarding@resend.dev>";
  if (!key) return { sent: false, reason: "email_not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) return { sent: false, reason: `resend_${res.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: "email_send_failed" };
  }
}

/** Minimal, safe HTML shell for transactional emails (inline styles only). */
export function emailShell(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="background:#16324f;color:#fff;border-radius:12px 12px 0 0;padding:18px 24px;font-weight:700;font-size:16px;">HFOS</div>
    <div style="background:#fff;border:1px solid #e4e8ef;border-top:0;border-radius:0 0 12px 12px;padding:24px;color:#0f1e34;">
      <h1 style="margin:0 0 12px;font-size:18px;">${heading}</h1>
      ${bodyHtml}
    </div>
    <p style="color:#6b7891;font-size:12px;text-align:center;margin-top:16px;">Household Financial Operating System</p>
  </div></body></html>`;
}
