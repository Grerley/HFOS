"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setHouseholdId, setToken } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

interface InviteInfo {
  valid: boolean; expired: boolean; accepted: boolean; has_account: boolean;
  household_name: string; inviter_name: string | null; email: string; name: string | null; role: string;
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const [token, setToken_] = useState<string | null>(null);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken_(t);
    if (!t) { setLoadError("This invite link is missing its token."); return; }
    api.get<InviteInfo>(`/invites/${t}`)
      .then((i) => { setInfo(i); setName(i.name ?? ""); })
      .catch((e: any) => setLoadError(e.message || "This invite link is invalid."));
  }, []);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (info && !info.has_account) {
      if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (password !== confirm) { setError("Passwords don't match."); return; }
    }
    setBusy(true);
    try {
      const res = await api.post<any>(`/invites/${token}/accept`, { name, password });
      if (res?.access_token) {
        // New account — auto sign-in.
        setToken(res.access_token);
        setHouseholdId(res.households?.[0]?.id ?? null);
        router.replace("/dashboard");
      } else {
        // Existing account — must sign in.
        setAddedMessage(res?.message || "You've been added to the household. Please sign in.");
      }
    } catch (err: any) {
      setError(err.message || "Could not accept the invitation.");
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
          {loadError ? (
            <Centered title="Invalid invitation" body={loadError} link="/login" linkText="Go to sign in" />
          ) : addedMessage ? (
            <Centered title="You're in" body={addedMessage} link="/login" linkText="Sign in" positive />
          ) : !info ? (
            <p className="text-center text-sm text-ink-muted">Loading invitation…</p>
          ) : info.accepted ? (
            <Centered title="Already accepted" body="This invitation has already been used." link="/login" linkText="Sign in" />
          ) : info.expired || !info.valid ? (
            <Centered title="Invitation expired" body="This invitation has expired. Ask the household owner to send a new one." link="/login" linkText="Go to sign in" />
          ) : (
            <form onSubmit={accept} className="space-y-4">
              <div>
                <h1 className="text-base font-semibold text-ink">Join {info.household_name}</h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {info.inviter_name ? `${info.inviter_name} invited you` : "You've been invited"} as {info.role} · {info.email}
                </p>
              </div>
              {info.has_account ? (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-ink-soft">
                  You already have an HFOS account for this email. Accept to add this household, then sign in as usual.
                </p>
              ) : (
                <>
                  <Field label="Your name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </Field>
                  <Field label="Choose a password">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                  </Field>
                  <Field label="Confirm password">
                    <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
                  </Field>
                </>
              )}
              {error && <p className="text-sm text-negative">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Joining…" : info.has_account ? `Join ${info.household_name}` : "Accept & create account"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ title, body, link, linkText, positive }: { title: string; body: string; link: string; linkText: string; positive?: boolean }) {
  return (
    <div className="space-y-3 text-center">
      <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${positive ? "bg-positive/10 text-positive" : "bg-muted text-ink-muted"}`} aria-hidden>
        {positive ? "✓" : "!"}
      </div>
      <h1 className="text-base font-semibold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted">{body}</p>
      <Link href={link} className="inline-block text-sm text-brand underline">{linkText}</Link>
    </div>
  );
}
