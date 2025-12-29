import {
    pgTable,
    uuid,
    varchar,
    bigint,
    timestamp,
    integer,
    uniqueIndex,
    boolean,
    decimal,
} from "drizzle-orm/pg-core";

/**
 * User Predictions Snapshots table - stores individual predictions from users
 * Each row represents ONE prediction (e.g., user X's rank 1 top_performer prediction)
 * This normalized structure allows tracking changes to individual predictions over time
 * 
 * Note: User predictions are independent of CoinGecko rounds - users can update predictions anytime
 */
export const userPredictionsSnapshots = pgTable("user_predictions_snapshots", {
    // Primary identifier
    id: uuid("id").defaultRandom().primaryKey(),
    
    // User identification
    walletAddress: varchar("wallet_address", { length: 44 }).notNull(), // Solana address (base58)
    
    // Prediction details
    predictionType: varchar("prediction_type", { length: 20 }).notNull(), // "top_performer" or "worst_performer"
    rank: integer("rank").notNull(), // 1-5 (which silo/slot - just independent bets now)
    symbol: varchar("symbol", { length: 50 }), // CoinGecko ID (can be long like "canton-network")
    predictedPercentage: integer("predicted_percentage").default(0), // User's predicted % change (from blockchain)
    priceAtPrediction: decimal("price_at_prediction", { precision: 24, scale: 8 }), // Price when prediction was made
    priceAtScoring: decimal("price_at_scoring", { precision: 24, scale: 8 }), // Price when prediction was scored/resolved
    actualPercentage: decimal("actual_percentage", { precision: 10, scale: 4 }), // Actual % change calculated at scoring
    
    // Timestamp from blockchain for THIS specific prediction
    predictionTimestamp: bigint("prediction_timestamp", { mode: "number" }), // Unix timestamp when user made this prediction
    duration: bigint("duration", { mode: "number" }), // Duration in seconds from blockchain
    resolutionTime: timestamp("resolution_time"), // When prediction is expected to resolve (predictionTimestamp + duration)
    
    // User metadata at time of snapshot
    points: bigint("points", { mode: "number" }).notNull().default(0),
    lastUpdated: bigint("last_updated", { mode: "number" }), // Last updated timestamp from blockchain
    
    // When this snapshot was taken
    snapshotTimestamp: timestamp("snapshot_timestamp").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    
    // Processing/Resolution fields
    processed: boolean("processed").notNull().default(false),
    pointsEarned: integer("points_earned").default(0),
    resolvedAt: timestamp("resolved_at"), // When resolution actually happened
    solanaSignature: varchar("solana_signature", { length: 100 }), // Transaction signature for the resolution
    resolvedBy: varchar("resolved_by", { length: 20 }), // "user" or "inngest"
}, (table) => ({
    // Unique constraint to prevent duplicate predictions
    // A user can only have one record per wallet+predictionType+rank+predictionTimestamp combination
    uniquePrediction: uniqueIndex("unique_prediction_idx").on(
        table.walletAddress,
        table.predictionType,
        table.rank,
        table.predictionTimestamp
    ),
}));

// Type inference helpers
export type UserPredictionsSnapshot = typeof userPredictionsSnapshots.$inferSelect;
export type NewUserPredictionsSnapshot = typeof userPredictionsSnapshots.$inferInsert;
