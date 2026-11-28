-- Review before applying to an existing deployment. Apply once; do not use on a fresh schema.
-- Adds podcast/usage structures only; no learning history is deleted.

ALTER TABLE `user` ADD COLUMN `podcast_language` varchar(191);
ALTER TABLE `user` ADD COLUMN `podcast_language_notice` int NOT NULL DEFAULT 1;
ALTER TABLE `learning_record` ADD COLUMN `source_language` varchar(191);
ALTER TABLE `learning_record` ADD COLUMN `target_language` varchar(191);
ALTER TABLE `learning_record` ADD COLUMN `last_podcast_at` timestamp;

CREATE TABLE `member_usage_day` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`day` varchar(191) NOT NULL,
	`translations` int NOT NULL DEFAULT 0,
	`playback_ms` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL,
	CONSTRAINT `member_usage_day_id` PRIMARY KEY(`id`)
);

CREATE TABLE `podcast_episode` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`kind` varchar(191) NOT NULL,
	`source_language` varchar(191) NOT NULL,
	`translation_language` varchar(191) NOT NULL,
	`status` varchar(191) NOT NULL DEFAULT 'queued',
	`title` text NOT NULL,
	`script` longtext,
	`manifest` text,
	`error_code` varchar(191),
	`manual_retries` int NOT NULL DEFAULT 0,
	`attempts` int NOT NULL DEFAULT 0,
	`lease_token` varchar(191),
	`lease_until` timestamp,
	`retry_at` timestamp,
	`created_at` timestamp NOT NULL,
	`expires_at` timestamp NOT NULL,
	`published_at` timestamp,
	`last_listened_at` timestamp,
	`listened_ms` int NOT NULL DEFAULT 0,
	`progress` int NOT NULL DEFAULT 0,
	`progress_offset` int NOT NULL DEFAULT 0,
	`coverage` text,
	`completed_at` timestamp,
	`playback_sequence` int NOT NULL DEFAULT 0,
	`playback_client` varchar(191),
	`duration_ms` int NOT NULL DEFAULT 0,
	CONSTRAINT `podcast_episode_id` PRIMARY KEY(`id`)
);

CREATE TABLE `podcast_preference` (
	`user_id` varchar(191) NOT NULL,
	`language` varchar(191) NOT NULL,
	`enabled` int NOT NULL DEFAULT 0,
	`trial_consumed_at` timestamp,
	`next_due_at` timestamp,
	`scan_after` timestamp,
	`active_episode_id` varchar(191),
	CONSTRAINT `podcast_preference_user_id` PRIMARY KEY(`user_id`)
);

CREATE TABLE `podcast_source` (
	`id` varchar(191) NOT NULL,
	`episode_id` varchar(191) NOT NULL,
	`record_id` varchar(191) NOT NULL,
	CONSTRAINT `podcast_source_id` PRIMARY KEY(`id`)
);

ALTER TABLE `member_usage_day` ADD CONSTRAINT `member_usage_day_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `podcast_episode` ADD CONSTRAINT `podcast_episode_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `podcast_preference` ADD CONSTRAINT `podcast_preference_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `podcast_source` ADD CONSTRAINT `podcast_source_episode_id_podcast_episode_id_fk` FOREIGN KEY (`episode_id`) REFERENCES `podcast_episode`(`id`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `podcast_source` ADD CONSTRAINT `podcast_source_record_id_learning_record_id_fk` FOREIGN KEY (`record_id`) REFERENCES `learning_record`(`id`) ON DELETE cascade ON UPDATE no action;

CREATE INDEX `idx_usage_user_day` ON `member_usage_day` (`user_id`,`day`);

CREATE INDEX `idx_usage_day` ON `member_usage_day` (`day`);

CREATE INDEX `idx_podcast_user_created` ON `podcast_episode` (`user_id`,`created_at`);

CREATE INDEX `idx_podcast_expiry` ON `podcast_episode` (`expires_at`);

CREATE INDEX `idx_podcast_pending` ON `podcast_episode` (`status`,`retry_at`);

CREATE INDEX `idx_podcast_source_episode` ON `podcast_source` (`episode_id`);

CREATE INDEX `idx_podcast_source_record` ON `podcast_source` (`record_id`);
