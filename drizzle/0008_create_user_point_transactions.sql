-- Create user_point_transactions table
CREATE TABLE "user_point_transactions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "wallet_address" VARCHAR(44) NOT NULL,
    "round_id" UUID NOT NULL,
    "transaction_type" VARCHAR(30) NOT NULL,
    "points_amount" INTEGER NOT NULL,
    "solana_signature" VARCHAR(88),
    "related_prediction_ids" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for common queries
CREATE INDEX idx_user_point_txns_wallet ON "user_point_transactions"("wallet_address");
CREATE INDEX idx_user_point_txns_round ON "user_point_transactions"("round_id");
CREATE INDEX idx_user_point_txns_type ON "user_point_transactions"("transaction_type");
