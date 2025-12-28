-- Add resolution tracking columns to user_predictions_snapshots
-- These columns support both user-triggered and inngest-triggered resolutions

-- Duration in seconds from blockchain
ALTER TABLE "user_predictions_snapshots" ADD COLUMN IF NOT EXISTS "duration" bigint;

-- When resolution actually happened
ALTER TABLE "user_predictions_snapshots" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;

-- Transaction signature for the resolution
ALTER TABLE "user_predictions_snapshots" ADD COLUMN IF NOT EXISTS "solana_signature" varchar(100);

-- Who triggered the resolution: "user" or "inngest"
ALTER TABLE "user_predictions_snapshots" ADD COLUMN IF NOT EXISTS "resolved_by" varchar(20);

