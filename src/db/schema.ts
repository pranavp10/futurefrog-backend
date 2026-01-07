import { pgTable, text, timestamp, integer, uuid } from 'drizzle-orm/pg-core';

export const cryptoMarketCache = pgTable('crypto_market_cache', {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: text('round_id').notNull(),
    coingeckoId: text('coingecko_id').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    currentPrice: text('current_price').notNull(),
    marketCap: text('market_cap'),
    marketCapRank: integer('market_cap_rank'),
    totalVolume: text('total_volume'),
    volumeRank: integer('volume_rank').notNull(),
    priceChangePercentage24h: text('price_change_percentage_24h').notNull(),
    snapshotTimestamp: timestamp('snapshot_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const cryptoPriceHistory = pgTable('crypto_price_history', {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: text('round_id').notNull(),
    coingeckoId: text('coingecko_id').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    currentPrice: text('current_price').notNull(),
    marketCap: text('market_cap'),
    marketCapRank: integer('market_cap_rank'),
    totalVolume: text('total_volume'),
    volumeRank: integer('volume_rank').notNull(),
    priceChangePercentage24h: text('price_change_percentage_24h').notNull(),
    snapshotTimestamp: timestamp('snapshot_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});
