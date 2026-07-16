# HFOS — Household Financial Operating System

A secure, explainable **personal-CFO platform** built from a long-running family Excel
budgeting system. It preserves the workbook's philosophy — income ownership, expense
responsibility, wealth creation as a budgeted obligation, property cash-flow, goals and
scenario thinking — as a modern web app.

> Every number is produced by a single server-side calculation engine and is traceable to
> its inputs. The UI never re-implements a formula.

## Architecture (production)

A single **Next.js 15** app (UI + API) running on **Cloudflare Workers** via OpenNext, with
data in **Cloudflare D1** (SQLite). No separate backend, no external database.

```
Cloudflare Worker (OpenNext)
├── UI            Next.js App Router (dashboard, planner, wealth, property, goals,
│                 scenarios, copilot, import, settings)
├── API           /api/* route handlers  →  Drizzle ORM  →  D1
│                 auth (PBKDF2 + JWT), RBAC + tenant isolation, calc engine,
│                 rule-based copilot, SheetJS workbook import
└── D1            hfos-db (integer-cents money, JSON columns, time-travel restore)
```

The whole app lives in **[`web/`](web/)**. Deploys automatically to Cloudflare on every push
to `main` via GitHub Actions (`.github/workflows/deploy.yml`).

## Repository layout

| Path | What |
|---|---|
| `web/` | The application (Next.js + API + D1 schema + tests) |
| `web/src/lib/calc.ts` | The calculation engine (pure, versioned, unit-tested) |
| `web/src/db/schema.ts` | Drizzle schema (16 entities) → D1 |
| `web/src/server/` | API router, services, auth, import |
| `web/migrations/` | D1 migrations |
| `web/DEPLOY_CLOUDFLARE.md` | Deploy runbook (Workers + D1 + secrets) |
| `docs/` | Data model, API reference, known limitations |
| `IMPLEMENTATION_PLAN.md` | Original product/architecture plan |

## Local development

```bash
cd web
npm install
npm test                                   # calc + auth unit tests
npx wrangler d1 migrations apply hfos-db --local
npm run preview                            # build + wrangler dev (Workers runtime + local D1)
```

For remote deploy, secrets and CI details, see **[web/DEPLOY_CLOUDFLARE.md](web/DEPLOY_CLOUDFLARE.md)**.

## Branches

- **`main`** — production Cloudflare app (this).
- **`legacy-python-backend`** — the original FastAPI + PostgreSQL reference implementation,
  preserved for reference. Not deployed.

## Status

MVP feature-complete and verified end-to-end on the Cloudflare Workers runtime against D1
(auth → household provisioning → budgeting → dashboard calculations → copilot → import).
Known limitations and the next-release backlog: **[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)**.
