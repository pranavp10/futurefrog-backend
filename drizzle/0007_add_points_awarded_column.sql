-- Add points_earned column to user_predictions_snapshots table
ALTER TABLE "user_predictions_snapshots" ADD COLUMN "points_earned" integer DEFAULT 0;
