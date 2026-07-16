"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH, setHouseholdId, setToken } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@hfos.app");
  const [password, setPassword] = useState("demo12345");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await AUTH.login(email, password);
      setToken(res.access_token);
      setHouseholdId(res.households[0]?.id ?? null);
      router.replace("/dashboard");
    } catch (err: any) {
      setError(err.message || "Login failed");
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
            <img src="/logo-full.png" alt="HFOS — Household Financial Operating System" className="block h-auto w-52" />
          </span>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-card p-6 shadow-sm">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-ink-muted">
            No account? <Link href="/register" className="text-brand underline">Create household</Link>
          </p>
          <p className="text-center text-[11px] text-ink-muted">
            Demo seed login is pre-filled. Run the seed script to enable it.
          </p>
        </form>
      </div>
    </div>
  );
}
