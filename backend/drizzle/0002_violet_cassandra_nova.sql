CREATE TABLE "statement_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"filename" varchar(200) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"statement_date" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"byte_length" integer NOT NULL,
	"pdf" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_archives_account_hash_unique" UNIQUE("household_id","account_id","sha256"),
	CONSTRAINT "statement_archives_snapshot_unique" UNIQUE("snapshot_id"),
	CONSTRAINT "statement_archives_size_valid" CHECK ("statement_archives"."byte_length" = octet_length("statement_archives"."pdf") AND "statement_archives"."byte_length" > 0 AND "statement_archives"."byte_length" <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_household_account_id_unique" UNIQUE("household_id","account_id","id");--> statement-breakpoint
ALTER TABLE "statement_archives" ADD CONSTRAINT "statement_archives_snapshot_household_account_fk" FOREIGN KEY ("household_id","account_id","snapshot_id") REFERENCES "public"."balance_snapshots"("household_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statement_archives_account_created_idx" ON "statement_archives" USING btree ("household_id","account_id","created_at");