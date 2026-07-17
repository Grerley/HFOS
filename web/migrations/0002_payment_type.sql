ALTER TABLE `budget_lines` ADD `payment_type` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE `budget_lines` SET `payment_type` = CASE
  WHEN `is_debit_order` = 1 THEN 'debit_order'
  WHEN `is_manual_payment` = 1 THEN 'manual'
  ELSE 'manual'
END;
