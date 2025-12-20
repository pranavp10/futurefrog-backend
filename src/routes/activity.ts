import { Elysia, t } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots } from "../db/schema";
import { eq, desc, and, isNotNull } from "drizzle-orm";

export const activityRoutes = new Elysia({ prefix: "/activity" })
    // Get recent prediction activity for a token
    .get("/:symbol", async ({ params }) => {
        const { symbol } = params;
        const tokenSymbol = symbol.toUpperCase();

        // Get recent predictions for this token
        const predictions = await db
            .select({
                walletAddress: userPredictionsSnapshots.walletAddress,
                predictionType: userPredictionsSnapshots.predictionType,
                timestamp: userPredictionsSnapshots.snapshotTimestamp,
                rank: userPredictionsSnapshots.rank,
            })
            .from(userPredictionsSnapshots)
            .where(and(
                eq(userPredictionsSnapshots.symbol, tokenSymbol),
                isNotNull(userPredictionsSnapshots.symbol)
            ))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(50);

        // Transform to activity format
        const activity = predictions.map(p => ({
            walletAddress: p.walletAddress,
            type: p.predictionType === "top_performer" ? "gainer" : "loser",
            timestamp: p.timestamp,
        }));

        return { activity };
    }, {
        params: t.Object({
            symbol: t.String()
        })
    });
