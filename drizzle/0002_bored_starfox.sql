CREATE TABLE "crypto_market_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"coingecko_id" varchar(255) NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"image_url" text,
	"current_price" numeric(20, 8) NOT NULL,
	"market_cap" numeric(30, 2),
	"market_cap_rank" integer,
	"total_volume" numeric(30, 2),
	"volume_rank" integer,
	"price_change_percentage_24h" numeric(10, 4) NOT NULL,
	"snapshot_timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
