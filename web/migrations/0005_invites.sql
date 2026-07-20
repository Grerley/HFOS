CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'partner' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` integer,
	`member_id` integer,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_invites_token_hash` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invites_household` ON `invites` (`household_id`);
