CREATE TABLE `mortgage_prepayments` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`,`account_id`) REFERENCES `mortgage_terms`(`household_id`,`account_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mortgage_prepayments_amount_format" CHECK("mortgage_prepayments"."amount" GLOB '*[0-9].[0-9][0-9]' AND length("mortgage_prepayments"."amount") <= 16),
	CONSTRAINT "mortgage_prepayments_amount_positive" CHECK(CAST("mortgage_prepayments"."amount" AS REAL) > 0),
	CONSTRAINT "mortgage_prepayments_date_format" CHECK(date("mortgage_prepayments"."date") IS "mortgage_prepayments"."date" AND "mortgage_prepayments"."date" >= '1000-01-01'),
	CONSTRAINT "mortgage_prepayments_note_length" CHECK("mortgage_prepayments"."note" IS NULL OR length("mortgage_prepayments"."note") <= 200)
);
--> statement-breakpoint
CREATE INDEX `mortgage_prepayments_account_date_idx` ON `mortgage_prepayments` (`household_id`,`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `mortgage_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`account_type` text DEFAULT 'MORTGAGE' NOT NULL,
	`principal` text NOT NULL,
	`annual_rate` text NOT NULL,
	`rate_type` text DEFAULT 'FIXED' NOT NULL,
	`compounding` text DEFAULT 'SEMI_ANNUAL' NOT NULL,
	`amortization_months` integer NOT NULL,
	`term_months` integer NOT NULL,
	`payment_frequency` text DEFAULT 'MONTHLY' NOT NULL,
	`start_date` text NOT NULL,
	`payment_amount` text,
	`property_value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`,`account_id`,`account_type`) REFERENCES `accounts`(`household_id`,`id`,`type`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mortgage_terms_account_type_valid" CHECK("mortgage_terms"."account_type" = 'MORTGAGE'),
	CONSTRAINT "mortgage_terms_principal_format" CHECK("mortgage_terms"."principal" GLOB '*[0-9].[0-9][0-9]' AND length("mortgage_terms"."principal") <= 16),
	CONSTRAINT "mortgage_terms_principal_positive" CHECK(CAST("mortgage_terms"."principal" AS REAL) > 0),
	CONSTRAINT "mortgage_terms_rate_valid" CHECK("mortgage_terms"."annual_rate" GLOB '[0-9]*' AND CAST("mortgage_terms"."annual_rate" AS REAL) BETWEEN 0 AND 30),
	CONSTRAINT "mortgage_terms_rate_type_valid" CHECK("mortgage_terms"."rate_type" IN ('FIXED', 'VARIABLE')),
	CONSTRAINT "mortgage_terms_compounding_valid" CHECK("mortgage_terms"."compounding" IN ('SEMI_ANNUAL', 'MONTHLY')),
	CONSTRAINT "mortgage_terms_frequency_valid" CHECK("mortgage_terms"."payment_frequency" IN ('MONTHLY', 'BIWEEKLY', 'ACCELERATED_BIWEEKLY', 'WEEKLY', 'ACCELERATED_WEEKLY')),
	CONSTRAINT "mortgage_terms_amortization_valid" CHECK("mortgage_terms"."amortization_months" BETWEEN 1 AND 600),
	CONSTRAINT "mortgage_terms_term_valid" CHECK("mortgage_terms"."term_months" BETWEEN 1 AND 120),
	CONSTRAINT "mortgage_terms_start_date_format" CHECK(date("mortgage_terms"."start_date") IS "mortgage_terms"."start_date" AND "mortgage_terms"."start_date" >= '1000-01-01'),
	CONSTRAINT "mortgage_terms_payment_valid" CHECK("mortgage_terms"."payment_amount" IS NULL OR ("mortgage_terms"."payment_amount" GLOB '*[0-9].[0-9][0-9]' AND CAST("mortgage_terms"."payment_amount" AS REAL) > 0)),
	CONSTRAINT "mortgage_terms_property_value_valid" CHECK("mortgage_terms"."property_value" IS NULL OR ("mortgage_terms"."property_value" GLOB '*[0-9].[0-9][0-9]' AND CAST("mortgage_terms"."property_value" AS REAL) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mortgage_terms_account_unique` ON `mortgage_terms` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mortgage_terms_household_account_unique` ON `mortgage_terms` (`household_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_household_id_type_unique` ON `accounts` (`household_id`,`id`,`type`);