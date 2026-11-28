-- Review before applying to an existing deployment. Apply once; do not use on a fresh schema.
-- Adds podcast/usage structures only; no learning history is deleted.

ALTER TABLE `user` ADD COLUMN `podcast_language` text;
ALTER TABLE `user` ADD COLUMN `podcast_language_notice` integer NOT NULL DEFAULT 1;
ALTER TABLE `learning_record` ADD COLUMN `source_language` text;
ALTER TABLE `learning_record` ADD COLUMN `target_language` text;
ALTER TABLE `learning_record` ADD COLUMN `last_podcast_at` integer;

CREATE TABLE `member_usage_day` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`translations` integer DEFAULT 0 NOT NULL,
	`playback_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_usage_user_day` ON `member_usage_day` (`user_id`,`day`);

CREATE INDEX `idx_usage_day` ON `member_usage_day` (`day`);

CREATE TABLE `podcast_episode` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_language` text NOT NULL,
	`translation_language` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`title` text NOT NULL,
	`script` text,
	`manifest` text,
	`error_code` text,
	`manual_retries` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`retry_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`published_at` integer,
	`last_listened_at` integer,
	`listened_ms` integer DEFAULT 0 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`progress_offset` integer DEFAULT 0 NOT NULL,
	`coverage` text,
	`completed_at` integer,
	`playback_sequence` integer DEFAULT 0 NOT NULL,
	`playback_client` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_podcast_user_created` ON `podcast_episode` (`user_id`,`created_at`);

CREATE INDEX `idx_podcast_expiry` ON `podcast_episode` (`expires_at`);

CREATE INDEX `idx_podcast_pending` ON `podcast_episode` (`status`,`retry_at`);

CREATE TABLE `podcast_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`trial_consumed_at` integer,
	`next_due_at` integer,
	`scan_after` integer,
	`active_episode_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `podcast_source` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`record_id` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `podcast_episode`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_id`) REFERENCES `learning_record`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_podcast_source_episode` ON `podcast_source` (`episode_id`);

CREATE INDEX `idx_podcast_source_record` ON `podcast_source` (`record_id`);
