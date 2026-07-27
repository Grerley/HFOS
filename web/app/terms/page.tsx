import type { Metadata } from "next";
import LegalShell, { H2 } from "@/components/LegalShell";

export const metadata: Metadata = { title: "Terms of Service — HFOS" };

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="2026">
      <p>
        These terms govern your use of HFOS. By creating an account or using the service, you agree to them. If you
        do not agree, do not use the service.
      </p>

      <H2>What HFOS is</H2>
      <p>
        HFOS is a personal-finance planning tool for households. It helps you organise budgets, payments, cash
        flow, wealth, goals and scenarios, and offers an AI copilot that phrases figures computed from your data.
      </p>

      <H2>Not financial advice</H2>
      <p>
        HFOS provides information and tools, not regulated financial, investment, tax or legal advice. Projections
        and scenarios are estimates based on the assumptions you enter and will differ from real outcomes. You are
        responsible for your own decisions and should consult a qualified professional where appropriate.
      </p>

      <H2>Your account</H2>
      <p>
        Keep your login credentials secure and provide accurate information. You are responsible for activity under
        your account and for the members you invite to your household.
      </p>

      <H2>Acceptable use</H2>
      <p>
        Do not misuse the service: no unlawful use, no attempts to breach security or access other households' data,
        and no disruption of the service or infrastructure.
      </p>

      <H2>Availability and changes</H2>
      <p>
        We work to keep the service available and reliable, but we provide it "as is" without warranties, and we may
        update, suspend or discontinue features. We will make reasonable efforts to inform you of material changes.
      </p>

      <H2>Limitation of liability</H2>
      <p>
        To the extent permitted by law, HFOS is not liable for indirect or consequential losses, or for decisions
        made in reliance on the tool. Replace this section with wording reviewed by your legal advisor for your
        jurisdiction.
      </p>

      <H2>Termination</H2>
      <p>
        You may delete your account at any time from Settings. We may suspend or terminate access for breach of
        these terms.
      </p>

      <H2>Governing law</H2>
      <p>
        These terms are governed by the laws of the Republic of South Africa, unless you specify otherwise. Confirm
        the governing law and dispute-resolution wording with your legal advisor.
      </p>

      <H2>Contact</H2>
      <p>Questions about these terms: contact us at the address published on our website.</p>
    </LegalShell>
  );
}
