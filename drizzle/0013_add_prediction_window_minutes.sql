-- Add prediction_window_minutes column to store duration more precisely
-- This allows for sub-hour prediction windows (e.g., 2 minutes for testing)

-- Add to ai_agent_predictions table
ALTER TABLE "ai_agent_predictions" 
ADD COLUMN IF NOT EXISTS "prediction_window_minutes" integer;

-- Add to ai_agent_prediction_sessions table
ALTER TABLE "ai_agent_prediction_sessions" 
ADD COLUMN IF NOT EXISTS "prediction_window_minutes" integer;

-- Backfill existing data (convert hours to minutes)
UPDATE "ai_agent_predictions" 
SET "prediction_window_minutes" = "prediction_window_hours" * 60 
WHERE "prediction_window_minutes" IS NULL;

UPDATE "ai_agent_prediction_sessions" 
SET "prediction_window_minutes" = "prediction_window_hours" * 60 
WHERE "prediction_window_minutes" IS NULL;

-- Add comment
COMMENT ON COLUMN "ai_agent_predictions"."prediction_window_minutes" IS 'Duration of prediction window in minutes (preferred over prediction_window_hours)';
COMMENT ON COLUMN "ai_agent_prediction_sessions"."prediction_window_minutes" IS 'Duration of prediction window in minutes (preferred over prediction_window_hours)';

