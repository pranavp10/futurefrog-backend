-- Create coin_metadata table
CREATE TABLE "coin_metadata" (
    "coingecko_id" VARCHAR(100) PRIMARY KEY,
    "symbol" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "image_url" VARCHAR(500),
    "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create unique index on symbol for quick lookups
CREATE UNIQUE INDEX "coin_metadata_symbol_idx" ON "coin_metadata"("symbol");


