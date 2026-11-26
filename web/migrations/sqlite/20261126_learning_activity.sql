-- Aggregate totals only; no individual caption or playback-event history.
CREATE TABLE "learning_activity" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "day" text NOT NULL,
  "sentences" integer NOT NULL,
  "duration_ms" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "idx_learning_activity_user_day" ON "learning_activity" ("user_id", "day");
