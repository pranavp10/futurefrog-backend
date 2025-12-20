import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    timestamp,
    index,
} from "drizzle-orm/pg-core";

/**
 * Comments table - stores user comments for tokens
 * Supports 1-level replies via parentId
 */
export const comments = pgTable("comments", {
    id: uuid("id").defaultRandom().primaryKey(),

    // Token this comment is for
    tokenSymbol: varchar("token_symbol", { length: 20 }).notNull(),

    // Author wallet address
    walletAddress: varchar("wallet_address", { length: 44 }).notNull(),

    // Comment content
    content: text("content").notNull(),

    // Parent comment ID for replies (null = top-level comment)
    parentId: uuid("parent_id"),

    // Heart count (denormalized for performance)
    heartCount: integer("heart_count").notNull().default(0),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    tokenSymbolIdx: index("comments_token_symbol_idx").on(table.tokenSymbol),
    walletAddressIdx: index("comments_wallet_address_idx").on(table.walletAddress),
    parentIdIdx: index("comments_parent_id_idx").on(table.parentId),
    createdAtIdx: index("comments_created_at_idx").on(table.createdAt),
}));

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
