# HFOS — Household Financial Operating System

A secure, explainable **personal-CFO platform** built from a long-running family Excel
budgeting system. Not a generic expense tracker: HFOS preserves the workbook's philosophy —
income ownership, expense responsibility, wealth creation as a budgeted obligation, property
cash-flow tracking, bonus/windfall allocation and scenario thinking — and turns it into a
reliable, auditable, multi-user product.

> Every number in HFOS is produced by a single server-side calculation engine and is
> traceable back to its inputs. The frontend never re-implements a formula.

---

## Table of contents

- [Highlights](#highlights)
- [Architecture](#architecture)
- [Quick start (SQLite, no Docker)](#quick-start-sqlite-no-docker)
- [Run with Docker (PostgreSQL)](#run-with-docker-postgresql)
- [Seed data & demo login](#seed-data--demo-login)
- [Testing](#testing)
- [Excel import](#excel-import)
- [Project structure](#project-structure)
- [Acceptance criteria coverage](#acceptance-criteria-coverage)
- [Further docs](#further-docs)

---

## Highlights

| Module | What it does |
|---|---|
| **Auth & household** | Register/login (JWT, bcrypt), create household, add members/spouse, RBAC roles (owner, partner, admin, advisor, viewer, child). |
| **Monthly planner** | Create/duplicate periods, editable budget grid with batch save, owner/category/due/status, planned-vs-actual, status lifecycle + locking with audit. |
| **Income & expenses** | Full workbook taxonomy (mandatory, insurance, living, property shortfalls, savings, ad-hoc, discretionary), recurrence, payment status, variance. |
| **Wealth creation** | Savings/investments as first-class budgeted outflows; monthly & annual savings rate. |
| **Property portfolio** | Properties + monthly cash-flow model, surplus/shortfall, gross/net yield, LTV, equity. |
| **Goals** | Target/date/priority, computed monthly requirement and progress. |
| **Scenario simulator** | Clone a baseline period, apply structured assumptions, compare deltas — stored separately from real budgets. |
| **Dashboard & reports** | Household + owner + category views, net worth, 12-month trends, monthly report. |
| **Excel import** | Classify sheets, map owners→members and sections→categories, **idempotent** import, review queue + reconciliation report. |
| **Copilot** | Explainable, rule-based answers ("what changed", "can we afford", "are we on track") that cite the calc-engine figures — with a typed seam for a future LLM. |
| **Security** | RBAC at the data layer, tenant isolation, immutable audit log, field-encryption helper, secrets via env. |

---

## Architecture

```
Next.js 14 + TypeScript + Tailwind   →   FastAPI (Python) + SQLAlchemy   →   PostgreSQL / SQLite
  renders numbers only                     services/calculations.py            integer-cents money
                                           = single source of financial maths
```

Design decisions, data-model summary, phases and risks: **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)**.

Key principles enforced in code:
- **Money is integer minor units (cents)** everywhere — no floats for money.
- **All financial maths lives in `backend/app/services/calculations.py`** (versioned, unit-tested).
- **`household_id` tenant isolation** enforced in the data-access layer, not just the UI.
- **Explainability**: calc snapshots carry a `formula_version`; scenario assumptions are versioned JSON.

---

## Quick start (SQLite, no Docker)

Requires Python 3.11+ and Node 20+. From a clean clone:

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m app.scripts.seed_db                          # creates hfos.db + demo data
uvicorn app.main:app --reload --port 8000
```

API is now at <http://localhost:8000>, interactive docs at <http://localhost:8000/docs>.

### 2. Frontend (in a second terminal)

```bash
cd frontend
npm install
cp .env.local.example .env.local                       # points at http://localhost:8000
npm run dev
```

App is at <http://localhost:3000>. Sign in with the demo login below.

---

## Run with Docker (PostgreSQL)

Production-parity stack (Postgres + backend + frontend), one command:

```bash
docker compose up --build
```

- Frontend → <http://localhost:3000>
- Backend  → <http://localhost:8000>
- The backend container seeds the database on first boot (`seed_db --if-empty`).

---

## Seed data & demo login

`python -m app.scripts.seed_db` provisions a representative household: default category
taxonomy, members (Alex/Sam/Robin), accounts, **three months imported from a synthetic sample
workbook**, a rental property with cash flow, goals, a scenario, and generated insights.

```
Email:    demo@hfos.app
Password: demo12345
```

> The **real** family workbook is never committed. A synthetic `data/sample_workbook.xlsx`
> with the same structure (owner columns, sections, ZAR) is generated for demo/tests. Import
> your own file from the **Import workbook** screen.

---

## Testing

```bash
cd backend && source .venv/bin/activate
python -m pytest          # 35 tests: calculation units, import reconciliation, workflow integration
```

Coverage includes: every calc-engine formula (income/expense/net/savings-rate/variance/owner
splits/property yield/LTV/bond amortisation/goals/scenario deltas), import reconciliation +
idempotency, RBAC denial, cross-household isolation, period locking, and the full budget→dashboard flow.

---

## Excel import

The importer (`backend/app/services/import_service.py`) classifies each sheet
(monthly / scenario / receivables / bonus / asset-sale / other), parses owner columns and
sections, maps them to members and categories, and imports **idempotently** — re-running never
duplicates a period. It produces a **reconciliation report** (imported income/expense vs the
sheet's own totals) and a **review queue** for rows it can't confidently map. See the
Import screen for a three-step preview → import → reconcile flow.

---

## Project structure

```
hfos/
├── IMPLEMENTATION_PLAN.md      # architecture, data model, phases, risks
├── docker-compose.yml          # Postgres + backend + frontend
├── .env.example                # environment template (never commit real secrets)
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app
│   │   ├── models/             # SQLAlchemy ORM (16 entities)
│   │   ├── services/
│   │   │   ├── calculations.py # THE calculation engine
│   │   │   ├── import_service.py
│   │   │   ├── scenario_service.py
│   │   │   ├── insight_service.py   # rule-based copilot (+ LLM seam)
│   │   │   └── ...
│   │   ├── api/                # routers per module
│   │   └── scripts/            # seed_db, gen_sample_workbook
│   └── tests/                  # pytest: unit + integration
└── frontend/
    ├── app/                    # Next.js App Router pages (all MVP screens)
    ├── components/             # reusable UI + charts
    └── lib/                    # api client, types, formatting
```

---

## Acceptance criteria coverage

| Minimum acceptance criterion | Where |
|---|---|
| Create a household | `POST /households`, `household_service` |
| Create a monthly budget | Planner · `POST /budget-periods` |
| Add income, expenses, savings, property costs, goals | Planner / Property / Goals screens + routes |
| Monthly surplus/shortfall correct | `calc.net_position` (tested) |
| Budget-vs-actual variance correct | `calc.period_variance` (tested) |
| Savings rate correct | `calc.savings_rate` (tested) |
| Working household dashboard | `/dashboard` + Dashboard screen |
| Property cash-flow tracking | `/properties/{id}/cash-flow` (tested) |
| Basic scenario planning | `/scenarios` + simulator (tested) |
| Import from the original Excel workbook | `/import/workbook` (reconciliation + idempotency tested) |
| Tests for the most important calculations | `tests/test_calculations.py` |
| Runs locally from a clean repo | this Quick start |

---

## Further docs

- **[docs/API.md](docs/API.md)** — endpoint reference
- **[docs/DATA_MODEL.md](docs/DATA_MODEL.md)** — entities and fields
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — production deployment guide
- **[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)** — known limitations & next-release backlog
