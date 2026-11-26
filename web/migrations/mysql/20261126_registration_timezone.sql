-- Additive migration. Existing users retain the previous Asia/Shanghai reset time.
ALTER TABLE `user` ADD COLUMN `registration_time_zone` varchar(100) NOT NULL DEFAULT 'Asia/Shanghai';
