ALTER TABLE `household_members` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `household_members` ADD `notify_email` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `household_members` ADD `notify_whatsapp` integer DEFAULT false NOT NULL;
