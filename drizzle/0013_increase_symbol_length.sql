-- Increase symbol column length to support longer CoinGecko IDs like "canton-network"
ALTER TABLE "user_predictions_snapshots" ALTER COLUMN "symbol" TYPE varchar(50);

