import { Elysia, t } from "elysia";
import { db } from "../db";
import { comments, commentHearts } from "../db/schema";
import { eq, desc, isNull, and, sql } from "drizzle-orm";

export const commentsRoutes = new Elysia({ prefix: "/comments" })
    // Get comments for a token
    .get("/:symbol", async ({ params }) => {
        const { symbol } = params;
        const tokenSymbol = symbol.toUpperCase();

        // Get top-level comments with their replies
        const topLevelComments = await db
            .select()
            .from(comments)
            .where(and(
                eq(comments.tokenSymbol, tokenSymbol),
                isNull(comments.parentId)
            ))
            .orderBy(desc(comments.createdAt))
            .limit(50);

        // Get all replies for these comments
        const commentIds = topLevelComments.map(c => c.id);

        let replies: typeof topLevelComments = [];
        if (commentIds.length > 0) {
            replies = await db
                .select()
                .from(comments)
                .where(sql`${comments.parentId} IN (${sql.join(commentIds, sql`, `)})`)
                .orderBy(comments.createdAt);
        }

        // Group replies under their parent comments
        const commentsWithReplies = topLevelComments.map(comment => ({
            ...comment,
            replies: replies.filter(r => r.parentId === comment.id)
        }));

        return { comments: commentsWithReplies };
    }, {
        params: t.Object({
            symbol: t.String()
        })
    })

    // Create a new comment
    .post("/", async ({ body }) => {
        const { tokenSymbol, walletAddress, content, parentId } = body;

        // Validate content
        if (!content.trim()) {
            return { error: "Content cannot be empty" };
        }

        if (content.length > 500) {
            return { error: "Content too long (max 500 characters)" };
        }

        // If it's a reply, verify parent exists
        if (parentId) {
            const parent = await db
                .select()
                .from(comments)
                .where(eq(comments.id, parentId))
                .limit(1);

            if (parent.length === 0) {
                return { error: "Parent comment not found" };
            }

            // Don't allow replies to replies (1-level only)
            if (parent[0].parentId) {
                return { error: "Cannot reply to a reply" };
            }
        }

        const [newComment] = await db
            .insert(comments)
            .values({
                tokenSymbol: tokenSymbol.toUpperCase(),
                walletAddress,
                content: content.trim(),
                parentId: parentId || null,
            })
            .returning();

        return { comment: newComment };
    }, {
        body: t.Object({
            tokenSymbol: t.String(),
            walletAddress: t.String(),
            content: t.String(),
            parentId: t.Optional(t.String())
        })
    })

    // Toggle heart on a comment
    .post("/:id/heart", async ({ params, body }) => {
        const { id } = params;
        const { walletAddress } = body;

        // Check if already hearted
        const existingHeart = await db
            .select()
            .from(commentHearts)
            .where(and(
                eq(commentHearts.commentId, id),
                eq(commentHearts.walletAddress, walletAddress)
            ))
            .limit(1);

        if (existingHeart.length > 0) {
            // Remove heart
            await db
                .delete(commentHearts)
                .where(eq(commentHearts.id, existingHeart[0].id));

            // Decrement heart count
            await db
                .update(comments)
                .set({ heartCount: sql`${comments.heartCount} - 1` })
                .where(eq(comments.id, id));

            return { hearted: false };
        } else {
            // Add heart
            await db
                .insert(commentHearts)
                .values({
                    commentId: id,
                    walletAddress,
                });

            // Increment heart count
            await db
                .update(comments)
                .set({ heartCount: sql`${comments.heartCount} + 1` })
                .where(eq(comments.id, id));

            return { hearted: true };
        }
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            walletAddress: t.String()
        })
    })

    // Check if user has hearted comments
    .get("/:symbol/hearts/:walletAddress", async ({ params }) => {
        const { symbol, walletAddress } = params;

        // Get all comment IDs for this token
        const tokenComments = await db
            .select({ id: comments.id })
            .from(comments)
            .where(eq(comments.tokenSymbol, symbol.toUpperCase()));

        if (tokenComments.length === 0) {
            return { heartedCommentIds: [] };
        }

        const commentIds = tokenComments.map(c => c.id);

        const hearts = await db
            .select({ commentId: commentHearts.commentId })
            .from(commentHearts)
            .where(and(
                sql`${commentHearts.commentId} IN (${sql.join(commentIds, sql`, `)})`,
                eq(commentHearts.walletAddress, walletAddress)
            ));

        return { heartedCommentIds: hearts.map(h => h.commentId) };
    }, {
        params: t.Object({
            symbol: t.String(),
            walletAddress: t.String()
        })
    })

    // Delete own comment
    .delete("/:id", async ({ params, body }) => {
        const { id } = params;
        const { walletAddress } = body;

        // Verify ownership
        const comment = await db
            .select()
            .from(comments)
            .where(eq(comments.id, id))
            .limit(1);

        if (comment.length === 0) {
            return { error: "Comment not found" };
        }

        if (comment[0].walletAddress !== walletAddress) {
            return { error: "Not authorized" };
        }

        // Delete the comment (cascade will handle hearts)
        await db
            .delete(comments)
            .where(eq(comments.id, id));

        return { success: true };
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            walletAddress: t.String()
        })
    });
