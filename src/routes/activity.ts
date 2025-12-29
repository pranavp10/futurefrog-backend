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
                predictedPercentage: userPredictionsSnapshots.predictedPercentage,
                priceAtPrediction: userPredictionsSnapshots.priceAtPrediction,
                duration: userPredictionsSnapshots.duration,
                points: userPredictionsSnapshots.points,
                pointsEarned: userPredictionsSnapshots.pointsEarned,
            })
            .from(userPredictionsSnapshots)
            .where(and(
                eq(userPredictionsSnapshots.symbol, tokenSymbol),
                isNotNull(userPredictionsSnapshots.symbol)
            ))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(50);

        // Transform to activity format
        const activity = predictions.map(p => {
            const entryPrice = p.priceAtPrediction ? parseFloat(p.priceAtPrediction) : null;
            const percentage = p.predictedPercentage || 0;
            const predictedPrice = entryPrice && percentage !== 0
                ? entryPrice * (1 + percentage / 100)
                : null;

            return {
                walletAddress: p.walletAddress,
                type: p.predictionType === "top_performer" ? "gainer" : "loser",
                timestamp: p.timestamp,
                entryPrice,
                predictedPrice,
                predictedPercentage: percentage,
                duration: p.duration,
                points: p.points || 0,
                pointsEarned: p.pointsEarned || 0,
            };
        });

        return { activity };
    }, {
        params: t.Object({
            symbol: t.String()
        })
    });

