CREATE TABLE `budget_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`file_hash` text NOT NULL,
	`filename` text NOT NULL,
	`sheet` text NOT NULL,
	`row` integer NOT NULL,
	`record_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_import_rows_household_key_unique` ON `budget_import_rows` (`household_id`,`key`);--> statement-breakpoint
CREATE TABLE `income` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text,
	`name` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`start_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`member_id`) REFERENCES `members`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "income_name_not_blank" CHECK(length(trim("income"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "income_amount_format" CHECK("income"."amount" GLOB '*[0-9].[0-9][0-9]' AND length("income"."amount") <= 16),
	CONSTRAINT "income_amount_positive" CHECK(CAST("income"."amount" AS REAL) > 0),
	CONSTRAINT "income_currency_format" CHECK("income"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "income_start_date_format" CHECK(date("income"."start_date") IS "income"."start_date")
);
--> statement-breakpoint
CREATE INDEX `income_household_date_idx` ON `income` (`household_id`,`start_date`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text,
	`category_id` text,
	`name` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`start_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`member_id`) REFERENCES `members`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`category_id`) REFERENCES `expense_categories`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_name_not_blank" CHECK(length(trim("__new_expenses"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "expenses_amount_format" CHECK("__new_expenses"."amount" GLOB '*[0-9].[0-9][0-9]' AND length("__new_expenses"."amount") <= 16),
	CONSTRAINT "expenses_amount_nonzero" CHECK(CAST("__new_expenses"."amount" AS REAL) != 0),
	CONSTRAINT "expenses_currency_format" CHECK("__new_expenses"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "expenses_start_date_format" CHECK(date("__new_expenses"."start_date") IS "__new_expenses"."start_date")
);
--> statement-breakpoint
INSERT INTO `__new_expenses`("id", "household_id", "member_id", "category_id", "name", "amount", "currency", "start_date", "created_at", "updated_at", "deleted_at") SELECT "id", "household_id", "member_id", "category_id", "name", "amount", "currency", "start_date", "created_at", "updated_at", "deleted_at" FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `expenses_household_date_idx` ON `expenses` (`household_id`,`start_date`,`id`);