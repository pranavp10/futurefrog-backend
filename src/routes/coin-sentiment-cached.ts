import { Elysia } from "elysia";
import { Connection } from "@solana/web3.js";
import { db } from "../db";
import { coinMetadata } from "../db/schema";
import { inArray } from "drizzle-orm";
import { redis, SENTIMENT_CACHE_TTL, SENTIMENT_CACHE_KEY } from "../lib/redis";
import { fetchAllUserPredictions, type UserPredictions } from "../lib/solana-predictions";

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

interface CachedPrediction {
    walletAddress: string;
    predictionType: "top_performer" | "worst_performer";
    rank: number;
    symbol: string;
}

interface CacheData {
    predictions: CachedPrediction[];
    cachedAt: number;
}

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

/**
 * Transform blockchain predictions to cache format
 */
function transformBlockchainPredictions(
    allUserPredictions: Array<{ userAddress: string; predictions: UserPredictions }>
): CachedPrediction[] {
    const cachedPredictions: CachedPrediction[] = [];

    for (const { userAddress, predictions } of allUserPredictions) {
        // Process top performers (ranks 1-5)
        for (let rank = 0; rank < 5; rank++) {
            const symbol = predictions.topPerformer[rank];
            if (symbol && symbol.trim() !== "") {
                cachedPredictions.push({
                    walletAddress: userAddress,
                    predictionType: "top_performer",
                    rank: rank + 1,
                    symbol: symbol.toUpperCase(),
                });
            }
        }

        // Process worst performers (ranks 1-5)
        for (let rank = 0; rank < 5; rank++) {
            const symbol = predictions.worstPerformer[rank];
            if (symbol && symbol.trim() !== "") {
                cachedPredictions.push({
                    walletAddress: userAddress,
                    predictionType: "worst_performer",
                    rank: rank + 1,
                    symbol: symbol.toUpperCase(),
                });
            }
        }
    }

    return cachedPredictions;
}

/**
 * Calculate sentiment from predictions
 */
function calculateSentiment(predictions: CachedPrediction[]): Map<string, {
    score: number;
    total: number;
    topCount: number;
    worstCount: number;
}> {
    const sentimentMap = new Map<string, {
        score: number;
        total: number;
        topCount: number;
        worstCount: number;
    }>();

    for (const prediction of predictions) {
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

        const current = sentimentMap.get(symbol);
        if (current) {
            current.score += points;
            current.total += 1;

            if (predictionType === "top_performer") {
                current.topCount += 1;
            } else {
                current.worstCount += 1;
            }
        }
    }

    return sentimentMap;
}

/**
 * Redis-cached coin sentiment route
 * Reads from Redis cache (2 min TTL), falls back to blockchain on cache miss
 */
export const coinSentimentCachedRoutes = new Elysia().get("/coin-sentiment-cached", async () => {
    try {
        let predictions: CachedPrediction[];

        // Try to get cached data
        const cachedData = await redis.get(SENTIMENT_CACHE_KEY);

        if (cachedData) {
            // Cache hit
            const parsed: CacheData = JSON.parse(cachedData);
            predictions = parsed.predictions;
            console.log(`📦 Sentiment: Cache hit (${predictions.length} predictions, cached ${Math.round((Date.now() - parsed.cachedAt) / 1000)}s ago)`);
        } else {
            // Cache miss - fetch from blockchain
            console.log("🔗 Sentiment: Cache miss, fetching from blockchain...");

            const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const connection = new Connection(rpcUrl, "confirmed");

            const allUserPredictions = await fetchAllUserPredictions(connection);

            // Transform to cache format
            predictions = transformBlockchainPredictions(allUserPredictions);

            // Store in cache with TTL
            const cacheData: CacheData = {
                predictions,
                cachedAt: Date.now(),
            };

            await redis.setex(SENTIMENT_CACHE_KEY, SENTIMENT_CACHE_TTL, JSON.stringify(cacheData));
            console.log(`✅ Sentiment: Cached ${predictions.length} predictions for ${SENTIMENT_CACHE_TTL}s`);
        }

        // Calculate sentiment scores
        const sentimentMap = calculateSentiment(predictions);

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
        const sentimentDataWithMetadata = sentimentData.map(item => {
            const meta = metadataMap.get(item.symbol);
            return {
                ...item,
                metadata: meta ? {
                    coingeckoId: meta.coingeckoId,
                    name: meta.name,
                    imageUrl: meta.imageUrl,
                } : undefined,
            };
        });

        return {
            success: true,
            data: sentimentDataWithMetadata,
            count: sentimentDataWithMetadata.length,
            cached: !!cachedData,
        };
    } catch (error) {
        console.error("Error calculating coin sentiment (cached):", error);
        return {
            success: false,
            error: "Failed to calculate coin sentiment",
        };
    }
});
