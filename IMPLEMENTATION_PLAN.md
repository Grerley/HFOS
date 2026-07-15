# HFOS — Implementation Plan

**Household Financial Operating System** — a secure, explainable personal-CFO platform
derived from a long-running family Excel budgeting system.

This document is the pre-build plan required before coding: proposed architecture,
data-model summary, MVP scope, phases, assumptions, and risks/mitigations. The rest of
the repository implements it.

---

## 1. Proposed architecture

HFOS is a modular monolith with strict domain boundaries — the shape the requirements
pack explicitly endorses for MVP ("A single monolith may be acceptable for MVP, provided
the domain boundaries are explicit").

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend — Next.js 14 (App Router) + TypeScript + Tailwind     │
│  Dashboard · Planner grid · Income · Expenses · Wealth ·        │
│  Property · Goals · Scenarios · Import · Settings · Copilot     │
│  (renders numbers ONLY from the API — no finance maths on client)│
└───────────────▲────────────────────────────────────────────────┘
                │ REST / JSON (JWT bearer)
┌───────────────┴────────────────────────────────────────────────┐
│ Backend — FastAPI (Python 3.11), clean service architecture      │
│                                                                  │
│  api/        thin routers, validation, RBAC enforcement          │
│  services/   business logic                                      │
│    ├─ calculations.py   ← THE single source of financial maths   │
│    ├─ budget_service    ← periods, lines, duplication            │
│    ├─ import_service     ← Excel parse/classify/map/review       │
│    ├─ scenario_service   ← clone baseline, apply assumptions      │
│    ├─ insight_service    ← rule-based copilot (LLM extension pt)  │
│    └─ audit_service      ← immutable audit events                 │
│  models/     SQLAlchemy 2.0 typed ORM (tenant = household_id)     │
│  security    bcrypt hashing · JWT · field encryption helper       │
└───────────────▲────────────────────────────────────────────────┘
                │ SQLAlchemy
┌───────────────┴────────────────────────────────────────────────┐
│ PostgreSQL (prod) · SQLite (zero-config local dev + tests)       │
│  JSON columns for scenario assumptions & calc snapshots          │
└──────────────────────────────────────────────────────────────────┘
```

### Key architectural decisions

| Decision | Rationale |
|---|---|
| **All financial maths lives server-side in `services/calculations.py`** | Requirement: "Avoid duplicated calculation logic across frontend and backend… Put core financial calculations in a dedicated service layer." The frontend never computes a total. |
| **Money stored as integer minor units (cents)** | Requirement Appendix B: "Use integer minor currency units… to avoid floating-point rounding errors." All amounts are `*_cents` integers; formatting happens at the edge. |
| **`household_id` on every tenant table + enforced in the data-access layer** | Requirement: row/tenant isolation "at API and data-access layers, not only in the UI." |
| **Calc snapshots persist `formula_version` + inputs** | Requirement: "Every calculated metric should store the formula version and inputs used when persisted." |
| **Scenario assumptions stored as versioned JSON** | Requirement Appendix B. |
| **SQLite default, Postgres via `DATABASE_URL`** | MVP acceptance: "run locally from a clean repository using documented instructions." SQLite = one command, no Docker. Postgres for production parity via docker-compose. |
| **Rule-based insight engine with a typed `CopilotProvider` seam** | Requirement 12: "the first version uses rule-based intelligence… leave clear extension points for future LLM integration." Numbers always come from the deterministic calc engine, never the model. |

---

## 2. Data-model summary

Sixteen core entities (mirrors requirements §7). Tenant key is `household_id`.

- **User** — a login identity (bcrypt-hashed password, role).
- **Household** — the tenant. base_currency, country, budget_cycle_day.
- **HouseholdMember** — spouse/dependant/contributor/beneficiary; may or may not be a login user (owner columns *Yamu / Gee / Purity* from the workbook).
- **Membership** — user↔household with a role (owner, partner, viewer, advisor, admin).
- **Account** — bank/cash/investment/loan/credit-card/bond/savings pocket, with dated balances.
- **Category** — hierarchical income/expense/saving/investment/transfer tree (default taxonomy from workbook sections).
- **BudgetPeriod** — a monthly planning window with status lifecycle.
- **BudgetLine** — a planned line: category, owner, payer, beneficiary, due day, recurrence, planned & actual amounts, priority, notes.
- **BudgetLineAllocation** — per-owner split of a line (fixed or percentage).
- **Transaction** — actual money movement (manual now, CSV/bank later), matchable to a line.
- **Property** — home/rental/acquisition target; ownership share, value, bond account.
- **PropertyCashFlow** — monthly rent vs bond/levies/utilities/insurance/maintenance/vacancy.
- **Goal** — target amount/date/priority/monthly-required, with funding sources.
- **Scenario** — cloned baseline + assumptions JSON + projected results JSON.
- **Insight** — rule/AI finding: type, severity, summary, explanation, action, status.
- **AuditEvent** — immutable record of sensitive actions (actor, before/after hash).

Full field list: `docs/DATA_MODEL.md`.

---

## 3. MVP scope (this release)

Delivered end-to-end and tested (maps to the P0 backlog + minimum acceptance criteria):

1. **Auth & household setup** — register, login, create household, add members/spouse, roles (RBAC).
2. **Monthly budget planner** — create/duplicate periods, income & expense lines, owner/category/due/status, planned vs actual, surplus/shortfall, status lifecycle + locking with audit.
3. **Income & expense management** — full default taxonomy, recurrence, payment status, variance.
4. **Wealth creation** — savings/investment lines as first-class budgeted outflows; savings rate.
5. **Property portfolio** — properties + monthly cash-flow, surplus/shortfall, gross/net yield, LTV.
6. **Goals** — target/date/monthly-required/progress.
7. **Scenario planning** — clone a baseline period, apply assumptions, compare deltas (cash, savings rate, net position).
8. **Dashboard & reporting** — household + owner + category dashboards; monthly report; category trends.
9. **Excel import** — classify sheets, map owners→members and sections→categories, idempotent import, review queue for unmapped rows + reconciliation report.
10. **Settings** — categories, accounts, members, currencies.
11. **Security** — bcrypt, JWT, RBAC at API + data layer, audit log, field-encryption helper, secrets via env.
12. **Explainable rule-based copilot** — "what changed", "are we over budget", "can we afford", "savings on track", "which property underperforms", "what to do with a bonus" — each answer cites the calc-engine numbers it used.

Deferred (documented in `docs/KNOWN_LIMITATIONS.md`): bank/open-banking sync, CSV import, OCR, PDF export, WhatsApp/push channels, Monte-Carlo, live LLM copilot, MFA, multi-currency FX.

---

## 4. Development phases

1. Data model + DB setup + default taxonomy.
2. Calculation engine (pure functions, unit-tested first).
3. Auth, RBAC, audit, service layer, API routers.
4. Excel import pipeline + rule-based insights.
5. Seed data + synthetic sample workbook.
6. Tests: unit (calculations, import reconciliation) + integration (workflows).
7. Frontend screens wired to the API.
8. Docs: README, API docs, deploy guide, limitations & next-release backlog.
9. Verify (tests + smoke run) and ship.

---

## 5. Key assumptions

- **Privacy:** the *real* family workbook is **not** committed. A synthetic sample workbook with the same structure (owner columns, sections, ZAR) is generated for import/demo/tests. Users import their own file.
- Default currency **ZAR**, country **ZA**, but everything is currency/geography-agnostic via config.
- Planning periods follow the workbook's "Dec4Jan / Jan4Feb" cycle model (configurable cycle day), not forced calendar months — resolving open question §20.
- Savings & investments **are** included in total expenses (workbook behaviour), with savings rate computed separately — resolving open question §20.
- Non-login members are first-class (children, dependants) — a member does not require a `user`.
- First release = **single household per user** active context; schema already carries `household_id` everywhere so multi-household is additive.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Calculation drift between UI and server | Single server-side engine; frontend renders API numbers only; unit tests pin formulas + `formula_version`. |
| Float rounding on money | Integer cents everywhere; conversion only at the presentation edge; tests assert exact cents. |
| Excel import mis-mapping | Deterministic classifier + explicit owner/section mapping + **review queue** for low-confidence rows + reconciliation report; import is idempotent (re-run safe). |
| Committing sensitive personal data | Real workbook excluded; synthetic sample only; `.gitignore` blocks `*.local`, real data dirs; secrets via `.env` (git-ignored). |
| Cross-household data leakage | `household_id` filter enforced in a shared query dependency; integration test asserts a viewer/other-household is denied. |
| "Run from clean repo" friction | SQLite default needs no services; `make dev` / documented commands; seed script creates a demo household. |
| Scope overload (P1/P2 creep) | Strict P0 focus; extension seams (copilot provider, connectors, recurrence) stubbed with clear TODOs and backlog. |
