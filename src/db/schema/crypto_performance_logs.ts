import {
    pgTable,
    uuid,
    varchar,
    text,
    decimal,
    integer,
    timestamp,
} from "drizzle-orm/pg-core";

// Performance category enum type
export const performanceCategory = ["top_gainer", "worst_performer"] as const;
export type PerformanceCategory = typeof performanceCategory[number];

// Crypto performance logs table - stores periodic snapshots of top gainers and losers
export const cryptoPerformanceLogs = pgTable("crypto_performance_logs", {
    // Primary identifier
    id: uuid("id").defaultRandom().primaryKey(),
    
    // Round identifier - groups all 10 records from the same API call
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
    
    // Performance classification
    performanceCategory: varchar("performance_category", { length: 20 }).notNull(), // "top_gainer" or "worst_performer"
    performanceRank: integer("performance_rank").notNull(), // 0-4 (1st through 5th)
    
    // Timestamps
    snapshotTimestamp: timestamp("snapshot_timestamp").notNull(), // When CoinGecko data was received
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type inference helpers
export type CryptoPerformanceLog = typeof cryptoPerformanceLogs.$inferSelect;
export type NewCryptoPerformanceLog = typeof cryptoPerformanceLogs.$inferInsert;

