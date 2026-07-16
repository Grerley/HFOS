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

Prereq: a free Cloudflare account and the repo on GitHub (done: `Grerley/HFOS`).

### 1. Create the D1 database
```bash
npm i -g wrangler
wrangler login
wrangler d1 create hfos-db
```
Copy the printed `database_id` — paste it into `web/wrangler.toml` under the D1 binding
(I'll leave a clearly-marked placeholder there).

### 2. Set secrets
Generate and store the app secrets (never commit them):
```bash
# JWT signing secret
wrangler secret put HFOS_SECRET_KEY
# Field-encryption key (optional in early release)
wrangler secret put HFOS_ENCRYPTION_KEY
```
For production via Workers Builds, set the same as **encrypted environment variables** in the
Cloudflare dashboard (Workers & Pages → your Worker → Settings → Variables).

### 3. Apply the database schema
```bash
cd web
wrangler d1 migrations apply hfos-db --remote     # production D1
# local dev uses:  wrangler d1 migrations apply hfos-db --local
```

### 4. Connect the repo for auto-deploy (Workers Builds)
Cloudflare dashboard → **Workers & Pages → Create → Connect to Git** → pick `Grerley/HFOS`:
- **Root directory:** `web`
- **Build command:** `npm run deploy:build`  (defined in `web/package.json`)
- **Branch:** `main` (production). Every push builds + deploys automatically.
- The build step runs `wrangler d1 migrations apply --remote` so schema stays in sync.

### 5. (Optional) custom domain
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
