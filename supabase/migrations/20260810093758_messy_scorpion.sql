CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"edge_case" text NOT NULL,
	"edge_case_detail" text NOT NULL,
	"transcript" jsonb NOT NULL,
	"criteria" jsonb NOT NULL,
	"pass_threshold" integer DEFAULT 70 NOT NULL,
	"partial_threshold" integer DEFAULT 40 NOT NULL,
	"verdict" "verdict",
	"overall_score" integer,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "goals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_cases_agent_created_idx" ON "test_cases" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "test_cases_location_agent_idx" ON "test_cases" USING btree ("location_id","agent_id");