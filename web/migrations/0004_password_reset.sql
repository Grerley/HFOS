CREATE TABLE `password_reset_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pw_reset_token_hash` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_pw_reset_user` ON `password_reset_tokens` (`user_id`);
