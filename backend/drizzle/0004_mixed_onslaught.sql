ALTER TABLE "statement_archives" ADD COLUMN "provider" varchar(20) DEFAULT 'SUNLIFE' NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_archives" ADD COLUMN "questrade" jsonb;