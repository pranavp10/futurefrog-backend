-- Add processed column to user_predictions_snapshots table
ALTER TABLE "user_predictions_snapshots" ADD COLUMN "processed" boolean DEFAULT false NOT NULL;

