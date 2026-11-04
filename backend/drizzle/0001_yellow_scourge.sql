CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_household_id_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "expense_categories_household_name_unique" UNIQUE("household_id","name"),
	CONSTRAINT "expense_categories_name_not_blank" CHECK (length(trim("expense_categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"category_id" uuid,
	"name" varchar(200) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'CAD' NOT NULL,
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "expenses_name_not_blank" CHECK (length(trim("expenses"."name")) > 0),
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount" > 0),
	CONSTRAINT "expenses_currency_format" CHECK ("expenses"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_member_household_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_household_fk" FOREIGN KEY ("household_id","category_id") REFERENCES "public"."expense_categories"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_household_date_idx" ON "expenses" USING btree ("household_id","start_date","id");