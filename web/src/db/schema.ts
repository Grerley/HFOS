/**
 * Drizzle schema for Cloudflare D1 (SQLite). Mirrors backend/app/models/*.
 * Money is integer minor units (cents). Dates are ISO text. Timestamps are unix ints.
 * Field names match the API contract and the calculation engine 1:1.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const ts = () => integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`).notNull();
const tsu = () => integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`).notNull();

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  password_hash: text("password_hash").notNull(),
  is_active: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const households = sqliteTable("households", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  base_currency: text("base_currency").default("ZAR").notNull(),
  country: text("country").default("ZA").notNull(),
  budget_cycle_day: integer("budget_cycle_day").default(1).notNull(),
  created_by_id: integer("created_by_id"),
  created_at: ts(),
  updated_at: tsu(),
});

export const householdMembers = sqliteTable("household_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  user_id: integer("user_id"),
  name: text("name").notNull(),
  relationship_label: text("relationship_label"),
  role: text("role").default("partner").notNull(),
  is_active: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const memberships = sqliteTable("memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: integer("user_id").notNull(),
  household_id: integer("household_id").notNull(),
  role: text("role").default("owner").notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  institution: text("institution"),
  owner_member_id: integer("owner_member_id"),
  currency: text("currency").default("ZAR").notNull(),
  current_balance_cents: integer("current_balance_cents").default(0).notNull(),
  balance_date: text("balance_date"),
  is_manual: integer("is_manual", { mode: "boolean" }).default(true).notNull(),
  is_active: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const accountBalances = sqliteTable("account_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id").notNull(),
  as_of: text("as_of").notNull(),
  balance_cents: integer("balance_cents").notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  parent_id: integer("parent_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  default_owner_member_id: integer("default_owner_member_id"),
  sort_order: integer("sort_order").default(0).notNull(),
  is_active: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  is_section: integer("is_section", { mode: "boolean" }).default(false).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const budgetPeriods = sqliteTable("budget_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  label: text("label").notNull(),
  start_date: text("start_date").notNull(),
  end_date: text("end_date").notNull(),
  status: text("status").default("draft").notNull(),
  locked_at: text("locked_at"),
  approved_at: text("approved_at"),
  source: text("source"),
  notes: text("notes"),
  created_at: ts(),
  updated_at: tsu(),
});

export const budgetLines = sqliteTable("budget_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  period_id: integer("period_id").notNull(),
  household_id: integer("household_id").notNull(),
  category_id: integer("category_id").notNull(),
  item_name: text("item_name").notNull(),
  owner_member_id: integer("owner_member_id"),
  payer_member_id: integer("payer_member_id"),
  beneficiary_member_id: integer("beneficiary_member_id"),
  planned_amount_cents: integer("planned_amount_cents").default(0).notNull(),
  actual_amount_cents: integer("actual_amount_cents").default(0).notNull(),
  due_day: integer("due_day"),
  due_note: text("due_note"),
  recurrence: text("recurrence").default("monthly").notNull(),
  payment_status: text("payment_status").default("planned").notNull(),
  is_recurring: integer("is_recurring", { mode: "boolean" }).default(true).notNull(),
  priority: integer("priority").default(3).notNull(),
  sort_order: integer("sort_order").default(0).notNull(),
  notes: text("notes"),
  source_ref: text("source_ref"),
  needs_review: integer("needs_review", { mode: "boolean" }).default(false).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const budgetLineAllocations = sqliteTable("budget_line_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  line_id: integer("line_id").notNull(),
  member_id: integer("member_id").notNull(),
  method: text("method").default("fixed").notNull(),
  amount_cents: integer("amount_cents").default(0).notNull(),
  percent_bp: integer("percent_bp").default(0).notNull(),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  account_id: integer("account_id"),
  date: text("date").notNull(),
  description: text("description").notNull(),
  merchant: text("merchant"),
  amount_cents: integer("amount_cents").notNull(),
  category_id: integer("category_id"),
  budget_line_id: integer("budget_line_id"),
  is_transfer: integer("is_transfer", { mode: "boolean" }).default(false).notNull(),
  transfer_account_id: integer("transfer_account_id"),
  source: text("source").default("manual").notNull(),
  confidence_bp: integer("confidence_bp"),
  notes: text("notes"),
  created_at: ts(),
  updated_at: tsu(),
});

export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  address_label: text("address_label"),
  ownership_share_bp: integer("ownership_share_bp").default(10000).notNull(),
  market_value_cents: integer("market_value_cents").default(0).notNull(),
  valuation_date: text("valuation_date"),
  outstanding_bond_cents: integer("outstanding_bond_cents").default(0).notNull(),
  bond_account_id: integer("bond_account_id"),
  rental_status: text("rental_status").default("rented").notNull(),
  notes: text("notes"),
  created_at: ts(),
  updated_at: tsu(),
});

export const propertyCashFlows = sqliteTable("property_cash_flows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  property_id: integer("property_id").notNull(),
  period_id: integer("period_id"),
  label: text("label"),
  rent_cents: integer("rent_cents").default(0).notNull(),
  bond_cents: integer("bond_cents").default(0).notNull(),
  levies_cents: integer("levies_cents").default(0).notNull(),
  rates_cents: integer("rates_cents").default(0).notNull(),
  utilities_cents: integer("utilities_cents").default(0).notNull(),
  insurance_cents: integer("insurance_cents").default(0).notNull(),
  maintenance_cents: integer("maintenance_cents").default(0).notNull(),
  agent_fees_cents: integer("agent_fees_cents").default(0).notNull(),
  vacancy_cents: integer("vacancy_cents").default(0).notNull(),
  other_cents: integer("other_cents").default(0).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  goal_type: text("goal_type"),
  target_amount_cents: integer("target_amount_cents").default(0).notNull(),
  current_amount_cents: integer("current_amount_cents").default(0).notNull(),
  target_date: text("target_date"),
  monthly_contribution_cents: integer("monthly_contribution_cents").default(0).notNull(),
  owner_member_id: integer("owner_member_id"),
  priority: integer("priority").default(3).notNull(),
  status: text("status").default("active").notNull(),
  linked_account_id: integer("linked_account_id"),
  notes: text("notes"),
  created_at: ts(),
  updated_at: tsu(),
});

export const goalFundings = sqliteTable("goal_fundings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goal_id: integer("goal_id").notNull(),
  source: text("source").notNull(),
  amount_cents: integer("amount_cents").default(0).notNull(),
  expected_date: text("expected_date"),
  probability_bp: integer("probability_bp").default(10000).notNull(),
  created_at: ts(),
  updated_at: tsu(),
});

export const scenarios = sqliteTable("scenarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  base_period_id: integer("base_period_id"),
  name: text("name").notNull(),
  description: text("description"),
  assumptions_json: text("assumptions_json", { mode: "json" }).$type<Record<string, number>>().default({}),
  projected_results_json: text("projected_results_json", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  schema_version: integer("schema_version").default(1).notNull(),
  created_by_id: integer("created_by_id"),
  created_at: ts(),
  updated_at: tsu(),
});

export const insights = sqliteTable("insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id").notNull(),
  period_id: integer("period_id"),
  type: text("type").notNull(),
  severity: text("severity").default("info").notNull(),
  summary: text("summary").notNull(),
  explanation: text("explanation"),
  action: text("action"),
  status: text("status").default("open").notNull(),
  evidence_json: text("evidence_json", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  created_at: ts(),
  updated_at: tsu(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  household_id: integer("household_id"),
  actor_user_id: integer("actor_user_id"),
  action: text("action").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id: integer("entity_id"),
  before_hash: text("before_hash"),
  after_hash: text("after_hash"),
  detail_json: text("detail_json", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  ip_metadata: text("ip_metadata"),
  created_at: ts(),
  updated_at: tsu(),
});
