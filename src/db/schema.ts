import { pgTable, text, timestamp, integer, uuid, numeric, index } from 'drizzle-orm/pg-core';

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

// User bets tracking table
export const userBets = pgTable('user_bets', {
    id: uuid('id').defaultRandom().primaryKey(),
    publicKey: text('public_key').notNull(),
    marketTicker: text('market_ticker').notNull(),
    marketTitle: text('market_title'),
    eventTitle: text('event_title'),
    side: text('side').notNull(), // 'yes' or 'no'
    contracts: numeric('contracts').notNull(),
    entryPrice: numeric('entry_price').notNull(),
    investedAmount: numeric('invested_amount').notNull(),
    txSignature: text('tx_signature').notNull().unique(),
    mint: text('mint'), // outcome token mint address
    status: text('status').notNull().default('pending'), // pending, confirmed, failed, pending_redemption, redeemed
    redemptionAmount: numeric('redemption_amount'),
    redemptionTxSignature: text('redemption_tx_signature'),
    closeTime: timestamp('close_time'), // market resolution time
    createdAt: timestamp('created_at').notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at'),
    redeemedAt: timestamp('redeemed_at'),
}, (table) => ({
    publicKeyIdx: index('user_bets_public_key_idx').on(table.publicKey),
    txSignatureIdx: index('user_bets_tx_signature_idx').on(table.txSignature),
    statusIdx: index('user_bets_status_idx').on(table.status),
}));
