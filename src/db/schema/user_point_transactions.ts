import {
    pgTable,
    uuid,
    varchar,
    integer,
    timestamp,
    text,
} from "drizzle-orm/pg-core";

/**
 * User Point Transactions table - tracks all point awards and changes
 * This table provides a complete audit trail of how users earned points
 * Allows reconciliation between database and blockchain state
 */
export const userPointTransactions = pgTable("user_point_transactions", {
    // Primary identifier
    id: uuid("id").defaultRandom().primaryKey(),
    
    // User and round identification
    walletAddress: varchar("wallet_address", { length: 44 }).notNull(),
    roundId: uuid("round_id").notNull(), // Links to crypto_performance_logs
    
    // Transaction details
    transactionType: varchar("transaction_type", { length: 30 }).notNull(), 
    // Types: 'prediction_exact_match', 'prediction_category_match', 'prediction_participation',
    //        'parlay_bonus_top', 'parlay_bonus_worst', 'cross_category_bonus'
    
    pointsAmount: integer("points_amount").notNull(),
    
    // Solana transaction reference
    solanaSignature: varchar("solana_signature", { length: 88 }), // Base58 encoded signature
    
    // Related prediction IDs (for traceability)
    relatedPredictionIds: text("related_prediction_ids"), // JSON array of UUIDs
    
    // Additional metadata
    metadata: text("metadata"), // JSON field for extra context
    
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type inference helpers
export type UserPointTransaction = typeof userPointTransactions.$inferSelect;
export type NewUserPointTransaction = typeof userPointTransactions.$inferInsert;




