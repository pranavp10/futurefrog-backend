import { Elysia, t } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots } from "../db/schema";
import { eq, desc, and, isNotNull, isNull } from "drizzle-orm";

export const userPredictionsRoutes = new Elysia({ prefix: "/user-predictions" })
    // Get current predictions for a user (latest snapshot)
    .get("/:walletAddress/current", async ({ params }) => {
        const { walletAddress } = params;

        // Get the most recent snapshot for this user
        const snapshots = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(eq(userPredictionsSnapshots.walletAddress, walletAddress))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(10); // Get latest 10 predictions (5 top + 5 worst)

        if (snapshots.length === 0) {
            return {
                walletAddress,
                topPerformers: [],
                worstPerformers: [],
                points: 0,
                lastUpdated: null,
                snapshotTimestamp: null,
            };
        }

        // Group by prediction type
        const topPerformers = snapshots
            .filter(s => s.predictionType === 'top_performer')
            .sort((a, b) => a.rank - b.rank)
            .map(s => ({
                rank: s.rank,
                symbol: s.symbol || '',
                timestamp: s.predictionTimestamp,
                pointsEarned: s.pointsEarned || 0,
                processed: s.processed,
            }));

        const worstPerformers = snapshots
            .filter(s => s.predictionType === 'worst_performer')
            .sort((a, b) => a.rank - b.rank)
            .map(s => ({
                rank: s.rank,
                symbol: s.symbol || '',
                timestamp: s.predictionTimestamp,
                pointsEarned: s.pointsEarned || 0,
                processed: s.processed,
            }));

        return {
            walletAddress,
            topPerformers,
            worstPerformers,
            points: snapshots[0].points,
            lastUpdated: snapshots[0].lastUpdated,
            snapshotTimestamp: snapshots[0].snapshotTimestamp,
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        })
    })

    // Get prediction history for a user (all snapshots)
    .get("/:walletAddress/history", async ({ params, query }) => {
        const { walletAddress } = params;
        const limit = query.limit ? parseInt(query.limit) : 50;
        const offset = query.offset ? parseInt(query.offset) : 0;

        // Get all snapshots for this user, grouped by snapshot timestamp
        const snapshots = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(eq(userPredictionsSnapshots.walletAddress, walletAddress))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(limit)
            .offset(offset);

        // Group predictions by snapshot timestamp
        const groupedBySnapshot = new Map<string, typeof snapshots>();
        
        for (const snapshot of snapshots) {
            const key = snapshot.snapshotTimestamp.toISOString();
            if (!groupedBySnapshot.has(key)) {
                groupedBySnapshot.set(key, []);
            }
            groupedBySnapshot.get(key)!.push(snapshot);
        }

        // Format the grouped snapshots
        const history = Array.from(groupedBySnapshot.entries()).map(([timestamp, predictions]) => {
            const topPerformers = predictions
                .filter(p => p.predictionType === 'top_performer')
                .sort((a, b) => a.rank - b.rank)
                .map(p => ({
                    rank: p.rank,
                    symbol: p.symbol || '',
                    timestamp: p.predictionTimestamp,
                    pointsEarned: p.pointsEarned || 0,
                    processed: p.processed,
                }));

            const worstPerformers = predictions
                .filter(p => p.predictionType === 'worst_performer')
                .sort((a, b) => a.rank - b.rank)
                .map(p => ({
                    rank: p.rank,
                    symbol: p.symbol || '',
                    timestamp: p.predictionTimestamp,
                    pointsEarned: p.pointsEarned || 0,
                    processed: p.processed,
                }));

            return {
                snapshotTimestamp: timestamp,
                points: predictions[0]?.points || 0,
                lastUpdated: predictions[0]?.lastUpdated || null,
                topPerformers,
                worstPerformers,
                totalPredictions: predictions.length,
            };
        });

        return {
            walletAddress,
            history,
            total: history.length,
            limit,
            offset,
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        }),
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String())
        })
    })

    // Get performance stats for a user
    .get("/:walletAddress/stats", async ({ params }) => {
        const { walletAddress } = params;

        // Get all processed predictions
        const predictions = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(and(
                eq(userPredictionsSnapshots.walletAddress, walletAddress),
                eq(userPredictionsSnapshots.processed, true)
            ));

        const totalPredictions = predictions.length;
        const totalPointsEarned = predictions.reduce((sum, p) => sum + (p.pointsEarned || 0), 0);
        
        // Calculate correct predictions (earned more than participation points)
        const correctPredictions = predictions.filter(p => (p.pointsEarned || 0) > 1).length;
        const exactMatches = predictions.filter(p => p.pointsEarned === 50).length;
        const categoryMatches = predictions.filter(p => p.pointsEarned === 10).length;

        // Get current points from latest snapshot
        const latest = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(eq(userPredictionsSnapshots.walletAddress, walletAddress))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(1);

        const currentPoints = latest[0]?.points || 0;

        return {
            walletAddress,
            currentPoints,
            totalPredictions,
            totalPointsEarned,
            correctPredictions,
            exactMatches,
            categoryMatches,
            accuracy: totalPredictions > 0 ? (correctPredictions / totalPredictions * 100).toFixed(2) : '0.00',
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        })
    });
