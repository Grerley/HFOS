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

**Copilot** is an **agentic analyst**: Claude (via Cloudflare **AI Gateway**, no secret
to manage) drives a set of **read-only, engine-backed tools** — periods, financials,
trends, period comparisons, budget lines, payments, net worth, goals, properties — to
investigate the real budget over multiple steps and answer grounded in calc-engine
figures. It never does arithmetic itself (every number comes from the deterministic
engine), keeps **per-user/per-chat conversation memory**, and is reachable from the web
app and over **Telegram**. A weekly **proactive analyst** surfaces trends, risks and
opportunities you haven't asked about, as Insights and a Telegram digest. The agentic
brain needs a capable model (Claude); it degrades to single-shot phrasing and then the
deterministic rule engine if the model is unavailable, so it never breaks. Provider is
configurable via `HFOS_COPILOT_PROVIDER` / `HFOS_COPILOT_MODEL`. The copilot is reachable from the web
app and over **Telegram** — link a chat to a household with a one-time code (Settings →
Connect Telegram); per-chat tenant scoping keeps households isolated. Disabled until a
bot token is set — see **[docs/TELEGRAM_SETUP.md](docs/TELEGRAM_SETUP.md)**.

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
