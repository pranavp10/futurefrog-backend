CREATE TABLE "coins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"logo_url" text,
	"current_price" numeric(20, 8),
	"market_cap" numeric(30, 2),
	"volume_24h" numeric(30, 2),
	"price_change_24h" numeric(10, 4),
	"price_change_percentage_24h" numeric(10, 4),
	"circulating_supply" numeric(30, 8),
	"total_supply" numeric(30, 8),
	"max_supply" numeric(30, 8),
	"rank" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coins_symbol_unique" UNIQUE("symbol"),
	CONSTRAINT "coins_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "global_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"param_title" text NOT NULL,
	"param_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
