-- Aggregate totals only; no individual caption or playback-event history.
CREATE TABLE `learning_activity` (
  `id` varchar(191) PRIMARY KEY NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `client_id` varchar(191) NOT NULL,
  `day` varchar(191) NOT NULL,
  `sentences` int NOT NULL,
  `duration_ms` int NOT NULL,
  `updated_at` timestamp NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
);
CREATE INDEX `idx_learning_activity_user_day` ON `learning_activity` (`user_id`, `day`);
