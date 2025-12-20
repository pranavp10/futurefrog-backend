import {
    pgTable,
    uuid,
    varchar,
    text,
    decimal,
    integer,
    timestamp,
} from "drizzle-orm/pg-core";

/**
 * Crypto Market Cache table - stores the latest full dataset from CoinGecko
 * This table is purged and overwritten on each snapshot run
 * Acts as a cache to avoid repeated CoinGecko API calls from the UI
 */
export const cryptoMarketCache = pgTable("crypto_market_cache", {
    // Primary identifier
    id: uuid("id").defaultRandom().primaryKey(),
    
    // Round identifier - links to crypto_performance_logs for the same snapshot
    roundId: uuid("round_id").notNull(),
    
    // CoinGecko data
    coingeckoId: varchar("coingecko_id", { length: 255 }).notNull(),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    imageUrl: text("image_url"),
    
    // Price and market data
    currentPrice: decimal("current_price", { precision: 20, scale: 8 }).notNull(),
    marketCap: decimal("market_cap", { precision: 30, scale: 2 }),
    marketCapRank: integer("market_cap_rank"),
    totalVolume: decimal("total_volume", { precision: 30, scale: 2 }),
    volumeRank: integer("volume_rank"),
    priceChangePercentage24h: decimal("price_change_percentage_24h", { precision: 10, scale: 4 }).notNull(),
    
    // Timestamps
    snapshotTimestamp: timestamp("snapshot_timestamp").notNull(), // When CoinGecko data was received
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type inference helpers
export type CryptoMarketCache = typeof cryptoMarketCache.$inferSelect;
export type NewCryptoMarketCache = typeof cryptoMarketCache.$inferInsert;





