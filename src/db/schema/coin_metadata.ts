import {
    pgTable,
    varchar,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Coin Metadata table - stores static information about coins
 * This table acts as a master list of all coins that have appeared in snapshots
 */
export const coinMetadata = pgTable("coin_metadata", {
    // CoinGecko identifier (primary key)
    coingeckoId: varchar("coingecko_id", { length: 100 }).primaryKey(),
    
    // Coin identifiers
    symbol: varchar("symbol", { length: 20 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    
    // Visual
    imageUrl: varchar("image_url", { length: 500 }),
    
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    // Index on symbol for quick lookups
    symbolIdx: uniqueIndex("coin_metadata_symbol_idx").on(table.symbol),
}));

// Type inference helpers
export type CoinMetadata = typeof coinMetadata.$inferSelect;
export type NewCoinMetadata = typeof coinMetadata.$inferInsert;





