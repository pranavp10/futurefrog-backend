-- Add new columns for percentage-based scoring system
-- These columns support the new accuracy-based scoring logic

-- Predicted percentage from blockchain (user's predicted % change)
ALTER TABLE "user_predictions_snapshots" 
ADD COLUMN IF NOT EXISTS "predicted_percentage" integer DEFAULT 0;

-- Price when the prediction was made (fetched from CoinGecko)
ALTER TABLE "user_predictions_snapshots" 
ADD COLUMN IF NOT EXISTS "price_at_prediction" decimal(24, 8);

-- Price when the prediction was scored (fetched from CoinGecko)
ALTER TABLE "user_predictions_snapshots" 
ADD COLUMN IF NOT EXISTS "price_at_scoring" decimal(24, 8);

-- Actual percentage change calculated at scoring time
ALTER TABLE "user_predictions_snapshots" 
ADD COLUMN IF NOT EXISTS "actual_percentage" decimal(10, 4);

