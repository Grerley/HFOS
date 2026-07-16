import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export interface Env {
  DB: D1Database;
  HFOS_SECRET_KEY?: string;
  HFOS_ENCRYPTION_KEY?: string;
  HFOS_COPILOT_PROVIDER?: string;
  // Workers AI binding (native, no secret) — present when [ai] is bound in wrangler.
  AI?: unknown;
  // Optional higher-quality provider; set as an encrypted secret to enable.
  ANTHROPIC_API_KEY?: string;
}

export type DB = DrizzleD1Database<typeof schema>;

export function getEnv(): Env {
  return getCloudflareContext().env as unknown as Env;
}

export function getDb(env: Env): DB {
  return drizzle(env.DB, { schema });
}

export function secret(env: Env): string {
  return env.HFOS_SECRET_KEY || "dev-only-change-me-please-generate-a-real-secret";
}
