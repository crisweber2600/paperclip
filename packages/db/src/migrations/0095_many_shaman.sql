ALTER TABLE "goals" ADD COLUMN "acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "last_verdict" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "last_verdict_reason" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "last_verdict_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "last_verdict_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "verdict_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_last_verdict_by_agent_id_agents_id_fk" FOREIGN KEY ("last_verdict_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;