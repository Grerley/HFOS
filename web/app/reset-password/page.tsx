"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AUTH } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Read the token from the URL on mount (avoids useSearchParams prerender needs).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (!token) { setError("This reset link is missing its token."); return; }
    setBusy(true);
    try {
      await AUTH.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err: any) {
      setError(err.message || "Could not reset your password.");
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
          {done ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-positive/10 text-positive" aria-hidden>✓</div>
              <h1 className="text-base font-semibold text-ink">Password reset</h1>
              <p className="text-sm text-ink-muted">You can now sign in with your new password. Redirecting…</p>
              <Link href="/login" className="inline-block text-sm text-brand underline">Sign in now</Link>
            </div>
          ) : token === null && typeof window !== "undefined" && !new URLSearchParams(window.location.search).get("token") ? (
            <div className="space-y-3 text-center">
              <h1 className="text-base font-semibold text-ink">Invalid reset link</h1>
              <p className="text-sm text-ink-muted">This link is missing its token. Request a new one.</p>
              <Link href="/forgot-password" className="inline-block text-sm text-brand underline">Request a new link</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="text-base font-semibold text-ink">Choose a new password</h1>
                <p className="mt-1 text-sm text-ink-muted">At least 8 characters. Avoid common passwords.</p>
              </div>
              <Field label="New password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </Field>
              <Field label="Confirm password">
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
              </Field>
              {error && <p className="text-sm text-negative">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">{busy ? "Resetting…" : "Reset password"}</Button>
              <p className="text-center text-xs text-ink-muted">
                <Link href="/login" className="text-brand underline">Back to sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
