CREATE TABLE IF NOT EXISTS `account_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`institution` text,
	`owner_member_id` integer,
	`currency` text DEFAULT 'ZAR' NOT NULL,
	`current_balance_cents` integer DEFAULT 0 NOT NULL,
	`balance_date` text,
	`is_manual` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`before_hash` text,
	`after_hash` text,
	`detail_json` text DEFAULT '{}',
	`ip_metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `budget_line_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`method` text DEFAULT 'fixed' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`percent_bp` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `budget_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`item_name` text NOT NULL,
	`owner_member_id` integer,
	`payer_member_id` integer,
	`beneficiary_member_id` integer,
	`planned_amount_cents` integer DEFAULT 0 NOT NULL,
	`actual_amount_cents` integer DEFAULT 0 NOT NULL,
	`due_day` integer,
	`due_note` text,
	`recurrence` text DEFAULT 'monthly' NOT NULL,
	`payment_status` text DEFAULT 'planned' NOT NULL,
	`is_recurring` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`source_ref` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `budget_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`locked_at` text,
	`approved_at` text,
	`source` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`default_owner_member_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_section` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_fundings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`source` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`expected_date` text,
	`probability_bp` integer DEFAULT 10000 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`goal_type` text,
	`target_amount_cents` integer DEFAULT 0 NOT NULL,
	`current_amount_cents` integer DEFAULT 0 NOT NULL,
	`target_date` text,
	`monthly_contribution_cents` integer DEFAULT 0 NOT NULL,
	`owner_member_id` integer,
	`priority` integer DEFAULT 3 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`linked_account_id` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `household_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`user_id` integer,
	`name` text NOT NULL,
	`relationship_label` text,
	`role` text DEFAULT 'partner' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `households` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'ZAR' NOT NULL,
	`country` text DEFAULT 'ZA' NOT NULL,
	`budget_cycle_day` integer DEFAULT 1 NOT NULL,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`period_id` integer,
	`type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`summary` text NOT NULL,
	`explanation` text,
	`action` text,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence_json` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`address_label` text,
	`ownership_share_bp` integer DEFAULT 10000 NOT NULL,
	`market_value_cents` integer DEFAULT 0 NOT NULL,
	`valuation_date` text,
	`outstanding_bond_cents` integer DEFAULT 0 NOT NULL,
	`bond_account_id` integer,
	`rental_status` text DEFAULT 'rented' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `property_cash_flows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`period_id` integer,
	`label` text,
	`rent_cents` integer DEFAULT 0 NOT NULL,
	`bond_cents` integer DEFAULT 0 NOT NULL,
	`levies_cents` integer DEFAULT 0 NOT NULL,
	`rates_cents` integer DEFAULT 0 NOT NULL,
	`utilities_cents` integer DEFAULT 0 NOT NULL,
	`insurance_cents` integer DEFAULT 0 NOT NULL,
	`maintenance_cents` integer DEFAULT 0 NOT NULL,
	`agent_fees_cents` integer DEFAULT 0 NOT NULL,
	`vacancy_cents` integer DEFAULT 0 NOT NULL,
	`other_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`base_period_id` integer,
	`name` text NOT NULL,
	`description` text,
	`assumptions_json` text DEFAULT '{}',
	`projected_results_json` text DEFAULT '{}',
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`account_id` integer,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`merchant` text,
	`amount_cents` integer NOT NULL,
	`category_id` integer,
	`budget_line_id` integer,
	`is_transfer` integer DEFAULT false NOT NULL,
	`transfer_account_id` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`confidence_bp` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);