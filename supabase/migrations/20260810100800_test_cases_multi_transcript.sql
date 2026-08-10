-- Rebuild test_cases for multi-transcript prompt evaluation packs.
TRUNCATE TABLE "test_cases";
--> statement-breakpoint
ALTER TABLE "test_cases" DROP COLUMN IF EXISTS "edge_case_detail";
--> statement-breakpoint
ALTER TABLE "test_cases" DROP COLUMN IF EXISTS "transcript";
--> statement-breakpoint
ALTER TABLE "test_cases" DROP COLUMN IF EXISTS "verdict";
--> statement-breakpoint
ALTER TABLE "test_cases" DROP COLUMN IF EXISTS "feedback";
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "scenario" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "transcripts" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "results" jsonb;
--> statement-breakpoint
ALTER TABLE "test_cases" ALTER COLUMN "scenario" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "test_cases" ALTER COLUMN "transcripts" DROP DEFAULT;
