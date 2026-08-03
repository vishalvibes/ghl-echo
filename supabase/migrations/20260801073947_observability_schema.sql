CREATE TYPE "public"."action_status" AS ENUM('open', 'done', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."call_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('completed', 'no_answer', 'voicemail', 'busy', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('pending', 'evaluated', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('pass', 'partial', 'fail');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"ghl_agent_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"prompt_snapshot" text,
	"prompt_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"ghl_call_id" varchar(128) NOT NULL,
	"ghl_contact_id" varchar(64),
	"contact_name" text,
	"contact_phone" varchar(32),
	"direction" "call_direction" NOT NULL,
	"outcome" "call_outcome" DEFAULT 'completed' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"recording_url" text,
	"transcript" jsonb NOT NULL,
	"ingest_status" "ingest_status" DEFAULT 'pending' NOT NULL,
	"ingest_error" text,
	"is_mock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"criterion_key" varchar(64) NOT NULL,
	"met" boolean NOT NULL,
	"value" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"evidence_turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"scorecard_id" uuid NOT NULL,
	"scorecard_version" integer NOT NULL,
	"overall_score" integer NOT NULL,
	"verdict" "verdict" NOT NULL,
	"summary" text NOT NULL,
	"caller_sentiment" varchar(16) NOT NULL,
	"model" varchar(64) NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"missing_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" varchar(48) NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"quote" text,
	"turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ghl_location_id" varchar(64) NOT NULL,
	"ghl_company_id" varchar(64),
	"name" text DEFAULT 'Unnamed location' NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	CONSTRAINT "locations_ghl_location_id_unique" UNIQUE("ghl_location_id")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"window" varchar(8) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"based_on_calls" integer NOT NULL,
	"items" jsonb NOT NULL,
	"model" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"pass_threshold" integer DEFAULT 70 NOT NULL,
	"partial_threshold" integer DEFAULT 40 NOT NULL,
	"criteria" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"turn_start" integer NOT NULL,
	"turn_end" integer NOT NULL,
	"action_type" varchar(48) NOT NULL,
	"reason" text NOT NULL,
	"severity" "severity" DEFAULT 'medium' NOT NULL,
	"status" "action_status" DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_results" ADD CONSTRAINT "criterion_results_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_results" ADD CONSTRAINT "criterion_results_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_location_ghl_agent_idx" ON "agents" USING btree ("location_id","ghl_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_location_ghl_call_idx" ON "calls" USING btree ("location_id","ghl_call_id");--> statement-breakpoint
CREATE INDEX "calls_agent_started_idx" ON "calls" USING btree ("agent_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_location_started_idx" ON "calls" USING btree ("location_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "criterion_results_eval_key_idx" ON "criterion_results" USING btree ("evaluation_id","criterion_key");--> statement-breakpoint
CREATE INDEX "criterion_results_agent_key_idx" ON "criterion_results" USING btree ("agent_id","criterion_key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_call_version_idx" ON "evaluations" USING btree ("call_id","scorecard_version");--> statement-breakpoint
CREATE INDEX "evaluations_agent_created_idx" ON "evaluations" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "findings_agent_type_idx" ON "findings" USING btree ("agent_id","type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_agent_window_hash_idx" ON "recommendations" USING btree ("agent_id","window","evidence_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_agent_version_idx" ON "scorecards" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "scorecards_active_idx" ON "scorecards" USING btree ("agent_id","is_active");--> statement-breakpoint
CREATE INDEX "segments_location_status_idx" ON "segments" USING btree ("location_id","status","created_at" DESC NULLS LAST);