import { Elysia } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots, coinMetadata } from "../db/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";

// Points allocation based on ranks
const POINTS_MAP = {
    top_performer: {
        1: 100,
        2: 60,
        3: 40,
        4: 20,
        5: 10,
    },
    worst_performer: {
        1: -100,
        2: -60,
        3: -40,
        4: -20,
        5: -10,
    },
};

interface CoinSentiment {
    symbol: string;
    sentimentScore: number;
    totalPredictions: number;
    topPerformerCount: number;
    worstPerformerCount: number;
    metadata?: {
        coingeckoId: string;
        name: string;
        imageUrl: string | null;
    };
}

export const coinSentimentRoutes = new Elysia().get("/coin-sentiment", async () => {
    try {
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

        // Calculate sentiment scores for each coin
        const sentimentMap = new Map<string, {
            score: number;
            total: number;
            topCount: number;
            worstCount: number;
        }>();

        for (const prediction of unprocessedPredictions) {
            const { symbol, predictionType, rank } = prediction;
            
            if (!symbol) continue;

            const points = POINTS_MAP[predictionType as keyof typeof POINTS_MAP]?.[rank as keyof typeof POINTS_MAP.top_performer] || 0;

            if (!sentimentMap.has(symbol)) {
                sentimentMap.set(symbol, {
                    score: 0,
                    total: 0,
                    topCount: 0,
                    worstCount: 0,
                });
            }

            const current = sentimentMap.get(symbol)!;
            current.score += points;
            current.total += 1;
            
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
                sentimentScore: data.score,
                totalPredictions: data.total,
                topPerformerCount: data.topCount,
                worstPerformerCount: data.worstCount,
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
        };
    } catch (error) {
        console.error("Error calculating coin sentiment:", error);
        return {
            success: false,
            error: "Failed to calculate coin sentiment",
        };
    }
});


