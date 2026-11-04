CREATE TYPE "public"."account_type" AS ENUM('CHEQUING', 'SAVINGS', 'INVESTMENT', 'CREDIT', 'LOAN', 'MORTGAGE');--> statement-breakpoint
CREATE TYPE "public"."balance_source" AS ENUM('MANUAL', 'PROJECTED', 'INTEGRATED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"name" varchar(200) NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" varchar(3) DEFAULT 'CAD' NOT NULL,
	"balance_source" "balance_source" DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_household_id_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "accounts_name_not_blank" CHECK (length(trim("accounts"."name")) > 0),
	CONSTRAINT "accounts_currency_format" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" "balance_source" DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"default_currency" varchar(3) DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_name_not_blank" CHECK (length(trim("households"."name")) > 0),
	CONSTRAINT "households_currency_format" CHECK ("households"."default_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_household_id_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "members_name_not_blank" CHECK (length(trim("members"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_household_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "public"."accounts"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshots_account_as_of_idx" ON "balance_snapshots" USING btree ("household_id","account_id","as_of");