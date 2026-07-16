"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH, setHouseholdId, setToken } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", household_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await AUTH.register(form.name, form.email, form.password, form.household_name || undefined);
      setToken(res.access_token);
      setHouseholdId(res.households[0]?.id ?? null);
      router.replace("/dashboard");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-brand-dark">HFOS</div>
          <p className="text-sm text-ink-muted">Create your household</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label="Your name">
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
          </Field>
          <Field label="Password (min 8 characters)">
            <Input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} required minLength={8} />
          </Field>
          <Field label="Household name (optional)">
            <Input value={form.household_name} onChange={(e) => update("household_name", e.target.value)} />
          </Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create household"}
          </Button>
          <p className="text-center text-xs text-ink-muted">
            Have an account? <Link href="/login" className="text-brand underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
