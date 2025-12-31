import {
    pgTable,
    uuid,
    varchar,
    timestamp,
    integer,
    decimal,
    text,
    boolean,
    bigint,
    index,
} from "drizzle-orm/pg-core";

/**
 * AI Agent Predictions table
 * Stores individual predictions made by AI agents
 * Each row represents ONE prediction (e.g., GPT-5.2's rank 1 top_performer prediction)
 */
export const aiAgentPredictions = pgTable("ai_agent_predictions", {
    // Primary identifier
    id: uuid("id").defaultRandom().primaryKey(),
    
    // Session identification - groups predictions made together
    sessionId: uuid("session_id").notNull(),
    
    // Agent identification (matches the keypair names)
    agentName: varchar("agent_name", { length: 50 }).notNull(),
    
    // Prediction details
    predictionType: varchar("prediction_type", { length: 20 }).notNull(), // "top_performer" or "worst_performer"
    rank: integer("rank").notNull(), // 1-5
    coingeckoId: varchar("coingecko_id", { length: 100 }).notNull(),
    symbol: varchar("symbol", { length: 20 }), // Ticker symbol for display
    
    // Price predictions
    priceAtPrediction: decimal("price_at_prediction", { precision: 24, scale: 8 }).notNull(),
    targetPrice: decimal("target_price", { precision: 24, scale: 8 }).notNull(),
    expectedPercentage: decimal("expected_percentage", { precision: 10, scale: 4 }).notNull(), // Expected % change
    confidence: varchar("confidence", { length: 20 }).notNull(), // "high", "medium", "low"
    
    // Reasoning
    reasoning: text("reasoning").notNull(), // Why this coin was picked
    keyFactors: text("key_factors"), // JSON array of key factors
    
    // Timing
    predictionTimestamp: timestamp("prediction_timestamp").notNull(), // When prediction was made
    predictionWindowHours: integer("prediction_window_hours").notNull().default(12), // How long the prediction is for (DEPRECATED - use predictionWindowMinutes)
    predictionWindowMinutes: integer("prediction_window_minutes"), // Duration in minutes (preferred)
    resolutionTimestamp: timestamp("resolution_timestamp"), // When prediction should be resolved
    
    // Market context at time of prediction
    marketContext: text("market_context"), // JSON with BTC price, market sentiment, etc.
    
    // Resolution fields
    resolved: boolean("resolved").notNull().default(false),
    priceAtResolution: decimal("price_at_resolution", { precision: 24, scale: 8 }),
    actualPercentage: decimal("actual_percentage", { precision: 10, scale: 4 }),
    directionCorrect: boolean("direction_correct"), // Was up/down prediction correct?
    resolvedAt: timestamp("resolved_at"),
    
    // Points/scoring
    accuracyScore: decimal("accuracy_score", { precision: 10, scale: 4 }), // How accurate was the prediction
    
    // Blockchain tracking (if prediction was submitted on-chain)
    onChainSubmitted: boolean("on_chain_submitted").notNull().default(false),
    solanaSignature: varchar("solana_signature", { length: 100 }),
    
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    // Index for querying by agent
    agentNameIdx: index("ai_predictions_agent_name_idx").on(table.agentName),
    // Index for querying by session
    sessionIdIdx: index("ai_predictions_session_id_idx").on(table.sessionId),
    // Index for querying unresolved predictions
    unresolvedIdx: index("ai_predictions_unresolved_idx").on(table.resolved, table.resolutionTimestamp),
    // Index for querying by coingecko_id
    coingeckoIdIdx: index("ai_predictions_coingecko_id_idx").on(table.coingeckoId),
}));

/**
 * AI Agent Prediction Sessions table
 * Groups predictions made in a single session with overall market context
 */
export const aiAgentPredictionSessions = pgTable("ai_agent_prediction_sessions", {
    id: uuid("id").defaultRandom().primaryKey(),
    
    // Agent identification
    agentName: varchar("agent_name", { length: 50 }).notNull(),
    
    // Session timing
    sessionTimestamp: timestamp("session_timestamp").notNull(),
    predictionWindowHours: integer("prediction_window_hours").notNull().default(12), // DEPRECATED - use predictionWindowMinutes
    predictionWindowMinutes: integer("prediction_window_minutes"), // Duration in minutes (preferred)
    resolutionTimestamp: timestamp("resolution_timestamp"),
    
    // Market context at time of session
    btcPrice: decimal("btc_price", { precision: 24, scale: 8 }),
    ethPrice: decimal("eth_price", { precision: 24, scale: 8 }),
    totalMarketCap: bigint("total_market_cap", { mode: "number" }),
    fearGreedIndex: integer("fear_greed_index"),
    marketSentiment: varchar("market_sentiment", { length: 20 }), // "bullish", "bearish", "neutral"
    marketContext: text("market_context"), // Full market analysis in markdown
    
    // Key risks identified
    keyRisks: text("key_risks"), // JSON array of risks
    
    // Resolution summary
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    topPerformerAccuracy: decimal("top_performer_accuracy", { precision: 10, scale: 4 }), // % of correct direction
    worstPerformerAccuracy: decimal("worst_performer_accuracy", { precision: 10, scale: 4 }),
    overallAccuracy: decimal("overall_accuracy", { precision: 10, scale: 4 }),
    avgMagnitudeError: decimal("avg_magnitude_error", { precision: 10, scale: 4 }), // Avg diff between predicted and actual %
    
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    agentSessionIdx: index("ai_sessions_agent_name_idx").on(table.agentName),
    unresolvedSessionIdx: index("ai_sessions_unresolved_idx").on(table.resolved, table.resolutionTimestamp),
}));

// Type inference helpers
export type AIAgentPrediction = typeof aiAgentPredictions.$inferSelect;
export type NewAIAgentPrediction = typeof aiAgentPredictions.$inferInsert;
export type AIAgentPredictionSession = typeof aiAgentPredictionSessions.$inferSelect;
export type NewAIAgentPredictionSession = typeof aiAgentPredictionSessions.$inferInsert;

