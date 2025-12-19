-- Drop the old table structure
DROP TABLE IF EXISTS "user_predictions_snapshots" CASCADE;

-- Create the new normalized structure
CREATE TABLE "user_predictions_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" varchar(44) NOT NULL,
    "prediction_type" varchar(20) NOT NULL,
    "rank" integer NOT NULL,
    "symbol" varchar(10),
    "prediction_timestamp" bigint,
    "points" bigint DEFAULT 0 NOT NULL,
    "last_updated" bigint,
    "snapshot_timestamp" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create unique index to prevent duplicates
CREATE UNIQUE INDEX "unique_prediction_idx" ON "user_predictions_snapshots" (
    "wallet_address",
    "prediction_type", 
    "rank",
    "prediction_timestamp"
);

-- Create indexes for common queries
CREATE INDEX "wallet_address_idx" ON "user_predictions_snapshots" ("wallet_address");
CREATE INDEX "prediction_type_idx" ON "user_predictions_snapshots" ("prediction_type");
CREATE INDEX "snapshot_timestamp_idx" ON "user_predictions_snapshots" ("snapshot_timestamp");
