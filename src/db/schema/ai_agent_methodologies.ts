import {
    pgTable,
    text,
    timestamp,
    serial,
    varchar,
} from "drizzle-orm/pg-core";

/**
 * AI Agent Methodologies table
 * Stores the research methodology for each AI agent
 */
export const aiAgentMethodologies = pgTable("ai_agent_methodologies", {
    id: serial("id").primaryKey(),
    
    // Agent identification (matches the keypair names)
    agentName: varchar("agent_name", { length: 50 }).notNull().unique(),
    
    // Display info
    displayName: varchar("display_name", { length: 100 }).notNull(),
    emoji: varchar("emoji", { length: 10 }).notNull(),
    
    // Methodology description
    approach: text("approach").notNull(), // Short summary of the approach
    methodology: text("methodology").notNull(), // Detailed methodology in markdown
    personality: text("personality").notNull(), // Personality traits and tendencies
    
    // Data sources and weights
    primaryDataSources: text("primary_data_sources").notNull(), // JSON array of data sources
    analysisWeights: text("analysis_weights"), // JSON object of analysis factor weights
    
    // Prompt for AI model
    predictionPrompt: text("prediction_prompt"), // System prompt to generate predictions
    
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Type inference helpers
export type AIAgentMethodology = typeof aiAgentMethodologies.$inferSelect;
export type NewAIAgentMethodology = typeof aiAgentMethodologies.$inferInsert;

