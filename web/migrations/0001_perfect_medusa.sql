CREATE TABLE `expense_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_line_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`comment_text` text NOT NULL,
	`comment_type` text DEFAULT 'note',
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_line_id` integer NOT NULL,
	`household_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`payment_method` text DEFAULT 'eft' NOT NULL,
	`paid_by_member_id` integer,
	`source_account_id` integer,
	`beneficiary` text,
	`reference` text,
	`notes` text,
	`is_reversal` integer DEFAULT false NOT NULL,
	`reversed_payment_record_id` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `responsible_member_id` integer;--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `source_account_id` integer;--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `is_debit_order` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `is_manual_payment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `requires_confirmation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_lines` ADD `manual_status` text;