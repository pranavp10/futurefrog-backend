-- Add close_time column to track market resolution time
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS close_time TIMESTAMP;

