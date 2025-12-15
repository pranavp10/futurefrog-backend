import {
    pgTable,
    uuid,
    varchar,
    text,
    decimal,
    integer,
    timestamp,
    boolean,
} from "drizzle-orm/pg-core";

// Coins/Cryptocurrency table
export const coins = pgTable("coins", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    symbol: varchar("symbol", { length: 50 }).notNull().unique(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    description: text("description"),
    logo: text("logo_url"),

    // Price data
    currentPrice: decimal("current_price", { precision: 20, scale: 8 }),
    marketCap: decimal("market_cap", { precision: 30, scale: 2 }),
    volume24h: decimal("volume_24h", { precision: 30, scale: 2 }),
    priceChange24h: decimal("price_change_24h", { precision: 10, scale: 4 }),
    priceChangePercentage24h: decimal("price_change_percentage_24h", { precision: 10, scale: 4 }),

    // Supply data
    circulatingSupply: decimal("circulating_supply", { precision: 30, scale: 8 }),
    totalSupply: decimal("total_supply", { precision: 30, scale: 8 }),
    maxSupply: decimal("max_supply", { precision: 30, scale: 8 }),

    // Ranking & status
    rank: integer("rank"),
    isActive: boolean("is_active").default(true),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Type inference helpers
export type Coin = typeof coins.$inferSelect;
export type NewCoin = typeof coins.$inferInsert;
