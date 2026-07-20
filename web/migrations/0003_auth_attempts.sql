CREATE TABLE `auth_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text,
	`ip` text,
	`kind` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_attempts_email` ON `auth_attempts` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_auth_attempts_ip` ON `auth_attempts` (`ip`,`created_at`);
