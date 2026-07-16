import { defineConfig } from "drizzle-kit";

// Generates SQLite migrations for Cloudflare D1. Apply with:
//   wrangler d1 migrations apply hfos-db --local   (local dev)
//   wrangler d1 migrations apply hfos-db --remote   (production)
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
