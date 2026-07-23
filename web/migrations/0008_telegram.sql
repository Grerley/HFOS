CREATE TABLE `telegram_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`telegram_user_id` text,
	`telegram_username` text,
	`user_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_chat_id_unique` ON `telegram_links` (`chat_id`);--> statement-breakpoint
CREATE INDEX `telegram_links_household_idx` ON `telegram_links` (`household_id`);--> statement-breakpoint
CREATE TABLE `telegram_link_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint
CREATE INDEX `telegram_link_codes_hash_idx` ON `telegram_link_codes` (`code_hash`);
