-- Additive migration. Existing users retain the previous Asia/Shanghai reset time.
ALTER TABLE "user" ADD COLUMN "registration_time_zone" text NOT NULL DEFAULT 'Asia/Shanghai';
