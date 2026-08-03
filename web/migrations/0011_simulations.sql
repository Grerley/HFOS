CREATE TABLE IF NOT EXISTS `simulations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`simulation_type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_member_id` integer,
	`currency` text DEFAULT 'ZAR' NOT NULL,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `simulation_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simulation_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`scenario_name` text NOT NULL,
	`scenario_type` text DEFAULT 'custom' NOT NULL,
	`assumptions_json` text DEFAULT '{}',
	`result_summary_json` text DEFAULT '{}',
	`risk_rating` text,
	`recommendation_status` text,
	`model_version` text,
	`version` integer DEFAULT 1 NOT NULL,
	`calculated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_simulations_household` ON `simulations` (`household_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sim_scenarios_sim` ON `simulation_scenarios` (`simulation_id`);
