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

## Rollback
- Workers keeps prior versions — roll back in the dashboard or `wrangler rollback`.
- D1 — `wrangler d1 time-travel restore hfos-db --timestamp <ISO>`.
