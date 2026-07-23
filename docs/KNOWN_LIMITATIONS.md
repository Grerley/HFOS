# Known limitations & next-release backlog

This is a **first working version** focused on the P0 (MVP) backlog and the minimum acceptance
criteria. It is a genuine foundation — clean architecture, tested calculations, real import — not
a finished commercial product. This document is honest about what is and isn't done.

## Known limitations (this release)

- **Migrations:** schema is driven by SQLAlchemy models + `create_all()` for dev/SQLite. An
  Alembic autogenerate step is documented for Postgres but no versioned migration file is
  committed yet.
- **Copilot is LLM-backed** through a provider seam, under a strict grounding contract: every
  number comes from the deterministic calc engine and is handed to the model as pre-formatted
  facts — the model only phrases, never computes. The default `auto` mode is cost-first: the free
  native Cloudflare **Workers AI** model handles every request and spills over to **Claude** (via
  Cloudflare **AI Gateway**, no API key — usage billed to Cloudflare credits) only when the daily
  free tier is spent, then degrades to the keyword rule engine. Providers are switchable via
  `HFOS_COPILOT_PROVIDER` (`auto`, `ai-gateway`, `anthropic`, `workers-ai`, `rules`); the model is
  overridable via `HFOS_COPILOT_MODEL`. **Current state:** AI Gateway credits are not yet loaded,
  so in practice the copilot runs entirely on the free native model and any Claude spillover falls
  through to the rule engine until credits are added. Intent matching in the rule tier remains
  keyword-based.
- **Net worth** is computed from account balances only; property market value and investment
  holdings are not yet folded into net worth (properties are tracked separately).
- **Transactions**: manual entry + line matching only. No CSV/bank import, no auto-categorisation,
  no split transactions, no duplicate detection yet.
- **No MFA / password reset / email invitations.** Partner "invite" creates the account directly
  with a temporary password (MVP shortcut); production needs signed email invites + reset flow.
- **Field encryption** helper exists and is used at the security layer, but no model field is
  encrypted at rest by default in this release (no sensitive PII beyond email/password-hash is
  stored yet). Password hashing (bcrypt) and audit hashing are active.
- **Reports**: JSON dashboard/monthly/trends endpoints only. No PDF/XLSX export pack.
- **Notifications**: insight generation exists; no scheduled reminders or email/push/WhatsApp delivery.
- **Multi-household**: schema supports it (every table carries `household_id`); the UI drives a
  single active household via `X-Household-Id`. No in-app household switcher yet.
- **Scenario engine** covers income/expense %, new expense, savings increase and a property
  acquisition bond calc. No Monte-Carlo, no natural-language scenario creation.
- **Import** maps monthly sheets → periods/lines and classifies specialised sheets, but does not
  yet materialise scenario/receivables/bonus sheets into their modules (they're classified and
  reported, not imported).
- **i18n / multi-currency**: single base currency per household; no FX conversion across currencies.

## Next-release backlog (prioritised)

### P1 — first commercial version
1. Alembic initial migration committed; `HFOS_AUTO_CREATE_TABLES=false` by default in prod.
2. CSV bank import with per-institution mapping templates + reconciliation view (HFOS-012, 112).
3. Auto-categorisation rules with confidence scores; split & duplicate-transaction handling.
4. Receivables, bonus/windfall allocation plans, asset-sale funding (HFOS-033, 081–083).
5. Property acquisition & sale scenarios surfaced in the UI (HFOS-073, 075).
6. Scenario compare charts + debt-service ratio + net-worth impact (HFOS-092).
7. Reports: monthly PDF/XLSX review pack + exports (HFOS-104, 105).
8. Notifications: due-date reminders + overspend/low-net-position alerts with channels (HFOS-130–133).
9. Email invitations, password reset, MFA, session/device management.
10. Import scenario/receivables/bonus sheets into their modules; owner-mapping confirmation UI.
11. Net worth incorporating property equity and investment holdings; emergency-fund-months metric.
12. Multi-household switcher.

### P2 — differentiators
- LLM copilot: the provider seam is **wired and live** (native Workers AI + Claude via AI Gateway,
  grounded phrasing over calc-engine facts), reachable from the web app **and over Telegram**
  (one-time-code chat linking, per-chat tenant scope; see `docs/TELEGRAM_SETUP.md` — disabled until
  a bot token is set). Remaining: WhatsApp copilot channel, CFO briefings, anomaly detection over
  history, natural-language scenarios (HFOS-093, 094, 120–124).
- Open-banking / aggregation sync (HFOS-013).
- Investment liquidity/risk classification, financial health score.
- Document vault (receipts/statements) with OCR extraction.
- WCAG 2.2 AA audit pass; offline draft capture on mobile.

## Testing gaps to close
- Frontend has no automated tests yet (backend has 35). Add component/e2e tests (Playwright).
- Add property-based tests for the calc engine and a golden-file test that reconciles a full
  sample workbook end to end.
