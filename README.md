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
├── UI            Next.js App Router (dashboard, planner, cash-flow, payments,
│                 wealth, property, goals, scenarios, copilot, import, settings).
│                 Design-token theming (dark/light/density), WCAG 2.2 AA,
│                 installable PWA with offline reads + a durable write queue.
├── API           /api/* route handlers  →  Drizzle ORM  →  D1
│                 auth (PBKDF2 + JWT), RBAC + tenant isolation, calc + settlement
│                 engine, cash-flow forecast, LLM copilot, SheetJS import
└── D1            hfos-db (integer-cents money, JSON columns, time-travel restore)
```

**Copilot** phrases answers with an LLM (Cloudflare **Workers AI** by default — no
secret to manage) but every figure it quotes is computed by the deterministic engine
and handed to the model as grounded facts; the model never does arithmetic. Set
`HFOS_COPILOT_PROVIDER=anthropic` with an `ANTHROPIC_API_KEY` secret for Claude, or
`rules` to disable the LLM. Any model failure degrades gracefully to the rule engine.

**Offline / PWA** — a service worker caches the app shell (network-first, cached-shell
fallback) and `GET /api` responses per household, so views render with last-synced data
offline. Mutations made offline are queued in IndexedDB with an auth snapshot and
replayed FIFO on reconnect; conflicts surface for review.

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

Feature-complete and verified end-to-end on the Cloudflare Workers runtime against D1.
Beyond the MVP (auth → budgeting → dashboard → import) the app now includes the full
**payment settlement engine** (per-line/household/category rollups, debit-order
confirmation, calendar view, bulk settle), a **cash-flow module** (timeline, runway,
forward projection), guided **budget & scenario wizards**, an **LLM copilot**, a premium
**design system** (dark/light/density) with a **WCAG 2.2 AA** pass, and **offline/PWA**
support. Known limitations and the next-release backlog:
**[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)**.
