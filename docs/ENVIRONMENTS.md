# HFOS environments & deployment pipeline

Two long-lived environments, one Cloudflare account, one codebase.

| | Dev | Production |
|---|---|---|
| Branch | `develop` | `main` |
| Worker | `hfos-dev` | `hfos` |
| URL | `hfos-dev.<account>.workers.dev` | `hfos.<account>.workers.dev` (→ `app.hfos.com`) |
| D1 database | `hfos-db-dev` | `hfos-db` |
| Copilot | `workers-ai` (free, no spend) | `auto` (Claude via AI Gateway) |
| Email | off (no Resend key) | Resend (once verified) |
| Telegram | dev bot (own token) | prod bot |
| Auth secret | insecure fallback allowed | strong `HFOS_SECRET_KEY` |

## Branching & release flow

```
feature/* ──PR──▶ develop ──(auto)──▶ deploy dev
                    │
                    └──PR (promotion)──▶ main ──(auto)──▶ deploy production
```

- All work branches off `develop` and is merged back via PR.
- Merging to `develop` auto-deploys **dev**.
- Promote by opening a PR **`develop` → `main`**; merging it is the **release gate** and auto-deploys **production**.
- Never commit directly to `develop` or `main`.

## Workflows (`.github/workflows/`)

| File | Trigger | Does |
|---|---|---|
| `ci.yml` | PR → `develop`/`main` | typecheck + tests + build (the merge gate) |
| `deploy-dev.yml` | push → `develop` | build → migrate `hfos-db-dev` → `wrangler deploy --env dev` → sync `DEV_*` secrets |
| `deploy-prod.yml` | push → `main` | build → migrate `hfos-db` → `wrangler deploy` → sync prod secrets |
| `provision-dev-db.yml` | manual | one-shot: create `hfos-db-dev` |

> On a private Free-plan repo GitHub can't hard-require CI before merge, so it is
> **process-enforced**: PRs merge only when `ci.yml` is green.

## Secrets (GitHub → Settings → Secrets and variables → Actions)

Production (existing): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (optional),
`HFOS_SECRET_KEY`, and optionally `RESEND_API_KEY`, `ANTHROPIC_API_KEY`,
`CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`.

Dev (name-prefixed, all optional — dev runs without them):
`DEV_HFOS_SECRET_KEY`, `DEV_CRON_SECRET`, `DEV_TELEGRAM_BOT_TOKEN`,
`DEV_TELEGRAM_WEBHOOK_SECRET`.

## Migrations policy

- Migrations are versioned files in `web/migrations/`, applied per-database by
  wrangler (idempotent — it tracks what each DB has applied).
- **Forward-only.** Never edit an already-applied migration; add a new one.
- Dev validates first (via the `develop` deploy); the identical files then run
  against prod on promotion.
- **Breaking changes use expand → migrate → contract** across two releases
  (add the new shape, backfill, then remove the old) so a deploy is never
  half-applied against live data.

## Dev Telegram bot (optional)

1. In Telegram, message **@BotFather** → `/newbot` → get a **token** + username.
2. Add GitHub secrets `DEV_TELEGRAM_BOT_TOKEN` and `DEV_TELEGRAM_WEBHOOK_SECRET`
   (any long random string), and set `TELEGRAM_BOT_USERNAME` under `[env.dev]`
   in `wrangler.toml` to the dev bot's username.
3. Register its webhook once to `https://hfos-dev.<account>.workers.dev/api/telegram/webhook`.

## Rollback

- **Worker:** `wrangler rollback` (per env) or redeploy a previous commit.
- **Database:** D1 time-travel — `wrangler d1 time-travel restore <db> --timestamp <ISO>`.
