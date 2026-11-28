-- Review before applying to an existing deployment. Apply once; do not use on a fresh schema.
-- Adds podcast/usage structures only; no learning history is deleted.

ALTER TABLE "user" ADD COLUMN "podcast_language" text;
ALTER TABLE "user" ADD COLUMN "podcast_language_notice" integer NOT NULL DEFAULT 1;
ALTER TABLE "learning_record" ADD COLUMN "source_language" text;
ALTER TABLE "learning_record" ADD COLUMN "target_language" text;
ALTER TABLE "learning_record" ADD COLUMN "last_podcast_at" timestamp;

CREATE TABLE "member_usage_day" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"translations" integer DEFAULT 0 NOT NULL,
	"playback_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL
);

CREATE TABLE "podcast_episode" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_language" text NOT NULL,
	"translation_language" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"title" text NOT NULL,
	"script" text,
	"manifest" text,
	"error_code" text,
	"manual_retries" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_until" timestamp,
	"retry_at" timestamp,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"published_at" timestamp,
	"last_listened_at" timestamp,
	"listened_ms" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"progress_offset" integer DEFAULT 0 NOT NULL,
	"coverage" text,
	"completed_at" timestamp,
	"playback_sequence" integer DEFAULT 0 NOT NULL,
	"playback_client" text,
	"duration_ms" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "podcast_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"trial_consumed_at" timestamp,
	"next_due_at" timestamp,
	"scan_after" timestamp,
	"active_episode_id" text
);

CREATE TABLE "podcast_source" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"record_id" text NOT NULL
);

ALTER TABLE "member_usage_day" ADD CONSTRAINT "member_usage_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "podcast_episode" ADD CONSTRAINT "podcast_episode_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "podcast_preference" ADD CONSTRAINT "podcast_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "podcast_source" ADD CONSTRAINT "podcast_source_episode_id_podcast_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episode"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "podcast_source" ADD CONSTRAINT "podcast_source_record_id_learning_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."learning_record"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "idx_usage_user_day" ON "member_usage_day" USING btree ("user_id","day");

CREATE INDEX "idx_usage_day" ON "member_usage_day" USING btree ("day");

CREATE INDEX "idx_podcast_user_created" ON "podcast_episode" USING btree ("user_id","created_at");

CREATE INDEX "idx_podcast_expiry" ON "podcast_episode" USING btree ("expires_at");

CREATE INDEX "idx_podcast_pending" ON "podcast_episode" USING btree ("status","retry_at");

CREATE INDEX "idx_podcast_source_episode" ON "podcast_source" USING btree ("episode_id");

CREATE INDEX "idx_podcast_source_record" ON "podcast_source" USING btree ("record_id");
