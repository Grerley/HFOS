import type { Metadata } from "next";
import LegalShell, { H2 } from "@/components/LegalShell";

export const metadata: Metadata = { title: "Privacy Policy — HFOS" };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="2026">
      <p>
        This policy explains what personal information HFOS ("we", "us") collects, why we collect it, and the
        choices you have. It is written to align with the Protection of Personal Information Act (POPIA) in South
        Africa, and with the GDPR where it applies.
      </p>

      <H2>Information we collect</H2>
      <p>
        Account details you provide (name, email, and a securely hashed password), and the household financial
        data you enter or import: accounts and balances, budgets, transactions, properties, goals, scenarios and
        related notes. We also keep basic security logs (for example, login attempts) to protect your account.
      </p>

      <H2>How we use it</H2>
      <p>
        To provide the service: to compute your budgets, forecasts and insights, to authenticate you, to send the
        notifications you enable, and to keep the service secure. We do not sell your personal information, and we
        do not use your financial data for advertising.
      </p>

      <H2>Where it is stored and who processes it</H2>
      <p>
        Your data is stored in Cloudflare D1 and served from Cloudflare's network. We use a small set of
        processors strictly to run features you use: Cloudflare (hosting and database), an AI provider reached
        through Cloudflare AI Gateway (only to phrase copilot answers over figures we compute), an email provider
        for transactional email such as password resets and invitations, and Telegram if you connect a chat. Each
        receives only what is needed for that feature.
      </p>

      <H2>Your rights</H2>
      <p>
        You can access and export a full copy of your household's data at any time from Settings, and you can
        permanently delete your account and its data from the same place. You may also contact us to request
        correction of your information or to raise a concern. Where POPIA or GDPR applies, you have the right to
        object to processing and to lodge a complaint with the relevant regulator.
      </p>

      <H2>Security</H2>
      <p>
        Passwords are hashed, access is authenticated and role-scoped, and each household's data is isolated.
        Traffic is encrypted in transit. No system is perfectly secure, but we design to minimise risk and to fail
        safe.
      </p>

      <H2>Retention</H2>
      <p>
        We keep your data while your account is active. When you delete your account, its data is removed, and any
        household left with no members is erased with it. Some limited security logs may be retained for a short
        period as required to protect the service.
      </p>

      <H2>Contact</H2>
      <p>
        Questions or requests: contact us at the address published on our website. Replace this line with your
        support email and, where required, the details of your information officer.
      </p>
    </LegalShell>
  );
}
