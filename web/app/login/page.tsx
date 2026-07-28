"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH, setHouseholdId, setToken } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        <div className="mb-6 flex justify-center text-ink">
          <Link href="/" aria-label="HFOS home"><Logo size={78} /></Link>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-card">
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
          <p className="text-center text-xs">
            <Link href="/forgot-password" className="text-ink-muted underline hover:text-ink">Forgot password?</Link>
          </p>
          <p className="text-center text-xs text-ink-muted">
            No account? <Link href="/register" className="font-medium text-brand hover:underline">Create household</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
