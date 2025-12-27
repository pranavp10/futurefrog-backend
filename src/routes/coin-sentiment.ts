import { Elysia } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots, coinMetadata } from "../db/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";

// Base points - all slots have equal weight (no rank significance)
const BASE_POINTS = {
    top_performer: 100,    // Bullish signal
    worst_performer: -100, // Bearish signal
};

// Minimum weight floor to prevent old predictions from being completely ignored
const MIN_WEIGHT = 0.1;

interface CoinSentiment {
    symbol: string;
    sentimentScore: number;
    totalPredictions: number;
    topPerformerCount: number;
    worstPerformerCount: number;
    avgFreshness: number; // Average time weight (0-1, higher = fresher)
    metadata?: {
        coingeckoId: string;
        name: string;
        imageUrl: string | null;
    };
}

/**
 * Calculate time-based weight for a prediction
 * Newer predictions have higher weight (up to 1.0)
 * Older predictions have lower weight (down to MIN_WEIGHT)
 */
function calculateTimeWeight(predictionTimestamp: Date, intervalMinutes: number): number {
    const now = Date.now();
    const predictionTime = predictionTimestamp.getTime();
    const ageMs = now - predictionTime;
    const ageMinutes = ageMs / (1000 * 60);
    
    // Weight decreases linearly from 1.0 to MIN_WEIGHT as prediction ages
    const weight = Math.max(MIN_WEIGHT, 1 - (ageMinutes / intervalMinutes));
    return weight;
}

export const coinSentimentRoutes = new Elysia().get("/coin-sentiment", async () => {
    try {
        // Get prediction interval from env (default 60 minutes)
        const predictionIntervalMinutes = parseInt(process.env.PREDICTION_INTERVAL_MINUTES || '60');

        // Fetch all unprocessed predictions with non-null symbols
        const unprocessedPredictions = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(
                and(
                    eq(userPredictionsSnapshots.processed, false),
                    isNotNull(userPredictionsSnapshots.symbol)
                )
            );

        // Calculate sentiment scores for each coin with time weighting
        const sentimentMap = new Map<string, {
            score: number;
            total: number;
            topCount: number;
            worstCount: number;
            totalWeight: number; // Sum of weights for averaging
        }>();

        for (const prediction of unprocessedPredictions) {
            const { symbol, predictionType, snapshotTimestamp } = prediction;
            
            if (!symbol) continue;

            // Get base points (no rank significance - all slots equal)
            const basePoints = BASE_POINTS[predictionType as keyof typeof BASE_POINTS] || 0;
            
            // Calculate time weight (newer = higher weight)
            const timeWeight = calculateTimeWeight(snapshotTimestamp, predictionIntervalMinutes);
            
            // Final weighted score
            const weightedPoints = basePoints * timeWeight;

            if (!sentimentMap.has(symbol)) {
                sentimentMap.set(symbol, {
                    score: 0,
                    total: 0,
                    topCount: 0,
                    worstCount: 0,
                    totalWeight: 0,
                });
            }

            const current = sentimentMap.get(symbol)!;
            current.score += weightedPoints;
            current.total += 1;
            current.totalWeight += timeWeight;
            
            if (predictionType === "top_performer") {
                current.topCount += 1;
            } else {
                current.worstCount += 1;
            }
        }

        // Convert to array and sort by sentiment score (descending)
        const sentimentData: CoinSentiment[] = Array.from(sentimentMap.entries())
            .map(([symbol, data]) => ({
                symbol,
                sentimentScore: Math.round(data.score * 10) / 10, // Round to 1 decimal
                totalPredictions: data.total,
                topPerformerCount: data.topCount,
                worstPerformerCount: data.worstCount,
                avgFreshness: Math.round((data.totalWeight / data.total) * 100) / 100, // Average freshness 0-1
            }))
            .sort((a, b) => b.sentimentScore - a.sentimentScore);

        // Fetch coin metadata for all symbols (normalize to lowercase for matching)
        const symbols = sentimentData.map(s => s.symbol);
        const symbolsLower = symbols.map(s => s.toLowerCase());
        const metadata = symbolsLower.length > 0 
            ? await db
                .select()
                .from(coinMetadata)
                .where(inArray(coinMetadata.symbol, symbolsLower))
            : [];

        // Create a map for quick lookup (using uppercase keys to match sentiment data)
        const metadataMap = new Map(
            metadata.map(m => [m.symbol.toUpperCase(), m])
        );

        // Attach metadata to sentiment data
        const sentimentDataWithMetadata = sentimentData.map(item => ({
            ...item,
            metadata: metadataMap.has(item.symbol) ? {
                coingeckoId: metadataMap.get(item.symbol)!.coingeckoId,
                name: metadataMap.get(item.symbol)!.name,
                imageUrl: metadataMap.get(item.symbol)!.imageUrl,
            } : undefined,
        }));

        return {
            success: true,
            data: sentimentDataWithMetadata,
            count: sentimentDataWithMetadata.length,
            predictionIntervalMinutes,
        };
    } catch (error) {
        console.error("Error calculating coin sentiment:", error);
        return {
            success: false,
            error: "Failed to calculate coin sentiment",
        };
    }
});

