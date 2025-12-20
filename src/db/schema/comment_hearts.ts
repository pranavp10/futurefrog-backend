import {
    pgTable,
    uuid,
    varchar,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { comments } from "./comments";

/**
 * Comment Hearts table - tracks who hearted which comment
 * Prevents duplicate hearts and enables un-heart functionality
 */
export const commentHearts = pgTable("comment_hearts", {
    id: uuid("id").defaultRandom().primaryKey(),

    // Reference to the comment
    commentId: uuid("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),

    // User who hearted
    walletAddress: varchar("wallet_address", { length: 44 }).notNull(),

    // When hearted
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    // Unique constraint: one heart per user per comment
    uniqueHeart: uniqueIndex("unique_heart_idx").on(table.commentId, table.walletAddress),
}));

export type CommentHeart = typeof commentHearts.$inferSelect;
export type NewCommentHeart = typeof commentHearts.$inferInsert;
