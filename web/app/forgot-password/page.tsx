"use client";
import Link from "next/link";
import { useState } from "react";
import { AUTH } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await AUTH.forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-block rounded-lg bg-[#ffffff] p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-full.png" alt="HFOS" className="block h-auto w-52" />
          </span>
        </div>
        <div className="rounded-xl border border-line bg-card p-6 shadow-sm">
          {sent ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-positive/10 text-positive" aria-hidden>✓</div>
              <h1 className="text-base font-semibold text-ink">Check your inbox</h1>
              <p className="text-sm text-ink-muted">
                If <span className="font-medium text-ink">{email}</span> is registered, a password-reset link is on its way. It expires in 1 hour.
              </p>
              <Link href="/login" className="inline-block text-sm text-brand underline">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="text-base font-semibold text-ink">Reset your password</h1>
                <p className="mt-1 text-sm text-ink-muted">Enter your email and we'll send you a reset link.</p>
              </div>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              {error && <p className="text-sm text-negative">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">{busy ? "Sending…" : "Send reset link"}</Button>
              <p className="text-center text-xs text-ink-muted">
                Remembered it? <Link href="/login" className="text-brand underline">Sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
