# HFOS on Cloudflare (Path B) — deploy runbook

Target: one Next.js app (UI + API) on **Cloudflare Workers** via **OpenNext**, data in
**Cloudflare D1** (SQLite). No Supabase, no separate backend, all free-tier to start.
Auto-deploys on `git push` via **Workers Builds**.

Status: this is the deploy contract. The app port is in progress on branch
`path-b-cloudflare` (calc engine + D1 schema + migration are done and tested).

---

## Division of labour

**I do (in the repo):** `wrangler.toml` (D1 binding), OpenNext config, build/migration
scripts, seed, the whole app. You never touch code.

**You do (one-time account wiring, ~20 min):** create the Cloudflare account + D1 database,
set secrets, connect the repo. Then I manage the running service via the Cloudflare MCP / `wrangler`.

---

## One-time setup (your steps)

Deployment is fully automated by **GitHub Actions** (`.github/workflows/deploy.yml`): every
push to `main` runs tests, builds, applies D1 migrations, deploys the Worker, and syncs the
runtime secret. The D1 database `hfos-db` and its schema are **already provisioned via MCP**.

The only thing that can't be automated is seeding the secret *values*, since only a repo admin
can write GitHub Actions secrets. Two one-time steps:

### 1. Create a Cloudflare API token
Cloudflare dashboard → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"**
template. Add **D1 → Edit** permission to it as well. Copy the token.

### 2. Add GitHub repository secrets
GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `HFOS_SECRET_KEY` | any long random string (a generated one is provided in chat) |
| `CLOUDFLARE_ACCOUNT_ID` | *optional* — only if the token isn't account-scoped |

Then push to `main` (or run the workflow manually via **Actions → Deploy → Run workflow**).
That's it — the workflow deploys and gives you a `*.workers.dev` URL. From then on, neither of
us touches secrets: the workflow re-syncs `HFOS_SECRET_KEY` to the Worker on every deploy, and
I manage the running service (D1, logs, rollbacks) via the Cloudflare MCP.

### (Optional) custom domain
Add `app.yourdomain.com` to the Worker in the dashboard; Cloudflare manages TLS.

---

## Local development (once the app port lands)
```bash
cd web
npm install
wrangler d1 migrations apply hfos-db --local
npm run seed:local        # demo household + sample workbook import
npm run dev               # wrangler dev (Workers runtime + local D1)
```

## Testing
```bash
cd web
npm test                  # vitest: calc engine + query/import unit tests
```

## Cost (free tier to start)
- Workers: free tier ~100k requests/day.
- D1: free tier — gigabytes of storage, millions of row-reads/day (check current limits).
- No always-on compute, no external DB, no pooler → effectively R0/month at household scale.

## Ongoing management (minimal overhead)
- Schema changes: edit `web/src/db/schema.ts` → `npm run db:generate` → commit → auto-applied on deploy.
- Ops: I manage D1 (queries, time-travel restore), Workers (logs, secrets, rollbacks, redeploys)
  through the **Cloudflare MCP server** / `wrangler` from our sessions.
- Time-travel restore gives point-in-time recovery of the database for ~30 days.

## Copilot LLM provider

The copilot phrases answers with an LLM; every number still comes from the calc
engine. The provider is chosen by `HFOS_COPILOT_PROVIDER` (in `wrangler.toml`):

- **`auto`** (default) — **cost-first.** The free native Workers AI model
  (10,000 Neurons/day, ~hundreds of answers) handles every request; when that call
  fails — e.g. the daily free allowance is spent — it **spills over to Claude** via
  AI Gateway, then to the rule engine. Day-to-day answers are free; you only pay
  Claude rates for overflow past the free tier.
- **`ai-gateway`** — **Claude** first (via AI Gateway + Unified Billing, no key),
  degrading to the native model, then rules. Use for best quality on every request.
- **`anthropic`** — direct Anthropic API (needs the `ANTHROPIC_API_KEY` secret).
- **`workers-ai`** — native model only, then rules.
- **`rules`** — deterministic, no LLM.

Every chain ends at the deterministic rule engine, so a spent free tier, missing
credential, unloaded credits, quota cap, or outage never breaks the copilot — it
just phrases a little more plainly.

> Note: the free-tier hard cap that triggers spill-over applies on the **Workers
> Free** plan. On **Workers Paid**, native usage past 10,000 Neurons/day is billed
> at Workers AI rates rather than failing, so `auto` stays on the (cheap) native
> model instead of spilling to Claude — still the lowest-cost path.

### Current state (deployed)

- **Provider:** `HFOS_COPILOT_PROVIDER = "auto"` (cost-first) is committed and deployed.
- **Gateway:** an AI Gateway named **`hfos`** exists and is wired via
  `HFOS_AI_GATEWAY_ID = "hfos"`; a `$100/week` spend limit and rate limit are set on it.
- **Model:** Claude tier defaults to `anthropic/claude-sonnet-4.5` (override with
  `HFOS_COPILOT_MODEL`; bump as Cloudflare's catalog adds newer Claude models).
- **Billing:** a payment method is set up, but **Unified Billing credits are not yet
  loaded** — a deliberate "no spend yet" choice. So today the copilot runs entirely on
  the **free native model**, and any Claude spillover falls through to the rule engine.
  The `[ai]` binding is configured; there is no secret and no CI change for this path.

### Turning Claude on later (when you want to be billed)

1. **Load Unified Billing credits** — Cloudflare → AI Gateway → **Credits Available →
   Manage → Top-up** (prepaid; a 5% fee applies on purchase, then provider token rates
   pass through with no markup). Optionally enable **auto top-up** so it never runs dry.
2. That's all that's needed for `auto`: Claude spillover activates automatically once a
   positive credit balance exists — no code change. To make Claude answer *every*
   request instead of only overflow, set `HFOS_COPILOT_PROVIDER = "ai-gateway"` (in
   `wrangler.toml`, or **Worker → Settings → Variables**).

## Rollback
- Workers keeps prior versions — roll back in the dashboard or `wrangler rollback`.
- D1 — `wrangler d1 time-travel restore hfos-db --timestamp <ISO>`.
