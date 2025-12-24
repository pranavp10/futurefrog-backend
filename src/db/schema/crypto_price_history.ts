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
 * Crypto Price History table - stores historical price data from CoinGecko
 * This table accumulates data over time and is never purged
 * Used for tracking price trends and historical analysis
 */
export const cryptoPriceHistory = pgTable("crypto_price_history", {
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
export type CryptoPriceHistory = typeof cryptoPriceHistory.$inferSelect;
export type NewCryptoPriceHistory = typeof cryptoPriceHistory.$inferInsert;

