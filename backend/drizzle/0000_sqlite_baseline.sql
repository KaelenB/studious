CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`balance_source` text DEFAULT 'MANUAL' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`member_id`) REFERENCES `members`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_name_not_blank" CHECK(length(trim("accounts"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "accounts_type_valid" CHECK("accounts"."type" IN ('CHEQUING', 'SAVINGS', 'INVESTMENT', 'CREDIT', 'LOAN', 'MORTGAGE')),
	CONSTRAINT "accounts_balance_source_valid" CHECK("accounts"."balance_source" IN ('MANUAL', 'PROJECTED', 'INTEGRATED')),
	CONSTRAINT "accounts_currency_format" CHECK("accounts"."currency" GLOB '[A-Z][A-Z][A-Z]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_household_id_id_unique` ON `accounts` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` text NOT NULL,
	`as_of` integer NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`account_id`) REFERENCES `accounts`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "balance_snapshots_amount_format" CHECK("balance_snapshots"."amount" GLOB '*[0-9].[0-9][0-9]' AND length("balance_snapshots"."amount") <= 16),
	CONSTRAINT "balance_snapshots_source_valid" CHECK("balance_snapshots"."source" IN ('MANUAL', 'PROJECTED', 'INTEGRATED'))
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_account_as_of_idx` ON `balance_snapshots` (`household_id`,`account_id`,`as_of`);--> statement-breakpoint
CREATE UNIQUE INDEX `balance_snapshots_household_account_id_unique` ON `balance_snapshots` (`household_id`,`account_id`,`id`);--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expense_categories_name_not_blank" CHECK(length(trim("expense_categories"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_household_id_id_unique` ON `expense_categories` (`household_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_household_name_unique` ON `expense_categories` (`household_id`,`name`);--> statement-breakpoint
CREATE TABLE `expenses` (
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
	CONSTRAINT "expenses_name_not_blank" CHECK(length(trim("expenses"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "expenses_amount_format" CHECK("expenses"."amount" GLOB '*[0-9].[0-9][0-9]' AND length("expenses"."amount") <= 16),
	CONSTRAINT "expenses_amount_positive" CHECK(CAST("expenses"."amount" AS REAL) > 0),
	CONSTRAINT "expenses_currency_format" CHECK("expenses"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "expenses_start_date_format" CHECK(date("expenses"."start_date") IS "expenses"."start_date")
);
--> statement-breakpoint
CREATE INDEX `expenses_household_date_idx` ON `expenses` (`household_id`,`start_date`,`id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_currency` text DEFAULT 'CAD' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "households_name_not_blank" CHECK(length(trim("households"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "households_currency_format" CHECK("households"."default_currency" GLOB '[A-Z][A-Z][A-Z]')
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_name_not_blank" CHECK(length(trim("members"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_household_id_id_unique` ON `members` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `statement_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`filename` text NOT NULL,
	`sha256` text NOT NULL,
	`amount` text NOT NULL,
	`statement_date` text NOT NULL,
	`currency` text NOT NULL,
	`byte_length` integer NOT NULL,
	`pdf` blob NOT NULL,
	`investments` text,
	`provider` text DEFAULT 'SUNLIFE' NOT NULL,
	`questrade` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`,`account_id`,`snapshot_id`) REFERENCES `balance_snapshots`(`household_id`,`account_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "statement_archives_size_valid" CHECK("statement_archives"."byte_length" = length("statement_archives"."pdf") AND "statement_archives"."byte_length" > 0 AND "statement_archives"."byte_length" <= 10485760),
	CONSTRAINT "statement_archives_provider_valid" CHECK("statement_archives"."provider" IN ('SUNLIFE', 'QUESTRADE')),
	CONSTRAINT "statement_archives_amount_format" CHECK("statement_archives"."amount" GLOB '*[0-9].[0-9][0-9]' AND length("statement_archives"."amount") <= 16)
);
--> statement-breakpoint
CREATE INDEX `statement_archives_account_created_idx` ON `statement_archives` (`household_id`,`account_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `statement_archives_account_hash_unique` ON `statement_archives` (`household_id`,`account_id`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `statement_archives_snapshot_unique` ON `statement_archives` (`snapshot_id`);