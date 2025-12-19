import {
    pgTable,
    uuid,
    varchar,
    bigint,
    timestamp,
    integer,
    uniqueIndex,
    boolean,
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
    rank: integer("rank").notNull(), // 1-5 (which silo)
    symbol: varchar("symbol", { length: 10 }), // The predicted crypto symbol (can be empty/null)
    
    // Timestamp from blockchain for THIS specific prediction
    predictionTimestamp: bigint("prediction_timestamp", { mode: "number" }), // Unix timestamp when user made this prediction
    
    // User metadata at time of snapshot
    points: bigint("points", { mode: "number" }).notNull().default(0),
    lastUpdated: bigint("last_updated", { mode: "number" }), // Last updated timestamp from blockchain
    
    // When this snapshot was taken
    snapshotTimestamp: timestamp("snapshot_timestamp").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    
    // Processing flag and points earned for this prediction
    processed: boolean("processed").notNull().default(false),
    pointsEarned: integer("points_earned").default(0),
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
