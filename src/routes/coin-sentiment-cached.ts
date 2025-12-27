import { Elysia } from "elysia";
import { Connection } from "@solana/web3.js";
import { db } from "../db";
import { coinMetadata } from "../db/schema";
import { inArray } from "drizzle-orm";
import { redis, SENTIMENT_CACHE_TTL, SENTIMENT_CACHE_KEY } from "../lib/redis";
import { fetchAllUserPredictions, type UserPredictions } from "../lib/solana-predictions";

// Base points - all slots have equal weight (no rank significance)
const BASE_POINTS = {
    top_performer: 100,    // Bullish signal
    worst_performer: -100, // Bearish signal
};

// Minimum weight floor to prevent old predictions from being completely ignored
const MIN_WEIGHT = 0.1;

interface CachedPrediction {
    walletAddress: string;
    predictionType: "top_performer" | "worst_performer";
    slot: number; // 0-4 (renamed from rank since rank no longer matters)
    symbol: string;
    timestamp: number; // Unix timestamp when prediction was made
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
    avgFreshness: number; // Average time weight (0-1, higher = fresher)
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
        // Process top performers (slots 0-4)
        for (let slot = 0; slot < 5; slot++) {
            const symbol = predictions.topPerformer[slot];
            const timestamp = predictions.topPerformerTimestamps[slot];
            if (symbol && symbol.trim() !== "" && timestamp > 0) {
                cachedPredictions.push({
                    walletAddress: userAddress,
                    predictionType: "top_performer",
                    slot,
                    symbol: symbol.toUpperCase(),
                    timestamp,
                });
            }
        }

        // Process worst performers (slots 0-4)
        for (let slot = 0; slot < 5; slot++) {
            const symbol = predictions.worstPerformer[slot];
            const timestamp = predictions.worstPerformerTimestamps[slot];
            if (symbol && symbol.trim() !== "" && timestamp > 0) {
                cachedPredictions.push({
                    walletAddress: userAddress,
                    predictionType: "worst_performer",
                    slot,
                    symbol: symbol.toUpperCase(),
                    timestamp,
                });
            }
        }
    }

    return cachedPredictions;
}

/**
 * Calculate time-based weight for a prediction
 * Newer predictions have higher weight (up to 1.0)
 * Older predictions have lower weight (down to MIN_WEIGHT)
 */
function calculateTimeWeight(predictionTimestamp: number, intervalMinutes: number): number {
    const now = Date.now();
    const predictionTimeMs = predictionTimestamp * 1000; // Convert unix seconds to ms
    const ageMs = now - predictionTimeMs;
    const ageMinutes = ageMs / (1000 * 60);
    
    // Weight decreases linearly from 1.0 to MIN_WEIGHT as prediction ages
    const weight = Math.max(MIN_WEIGHT, 1 - (ageMinutes / intervalMinutes));
    return weight;
}

/**
 * Calculate sentiment from predictions with time weighting
 */
function calculateSentiment(predictions: CachedPrediction[], intervalMinutes: number): Map<string, {
    score: number;
    total: number;
    topCount: number;
    worstCount: number;
    totalWeight: number;
}> {
    const sentimentMap = new Map<string, {
        score: number;
        total: number;
        topCount: number;
        worstCount: number;
        totalWeight: number;
    }>();

    for (const prediction of predictions) {
        const { symbol, predictionType, timestamp } = prediction;

        if (!symbol) continue;

        // Get base points (no rank/slot significance - all slots equal)
        const basePoints = BASE_POINTS[predictionType as keyof typeof BASE_POINTS] || 0;
        
        // Calculate time weight (newer = higher weight)
        const timeWeight = calculateTimeWeight(timestamp, intervalMinutes);
        
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

        const current = sentimentMap.get(symbol);
        if (current) {
            current.score += weightedPoints;
            current.total += 1;
            current.totalWeight += timeWeight;

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
 * Uses time-weighted scoring where newer predictions have more influence
 */
export const coinSentimentCachedRoutes = new Elysia().get("/coin-sentiment-cached", async () => {
    try {
        // Get prediction interval from env (default 60 minutes)
        const predictionIntervalMinutes = parseInt(process.env.PREDICTION_INTERVAL_MINUTES || '60');
        
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

            // Transform to cache format (includes timestamps)
            predictions = transformBlockchainPredictions(allUserPredictions);

            // Store in cache with TTL
            const cacheData: CacheData = {
                predictions,
                cachedAt: Date.now(),
            };

            await redis.setex(SENTIMENT_CACHE_KEY, SENTIMENT_CACHE_TTL, JSON.stringify(cacheData));
            console.log(`✅ Sentiment: Cached ${predictions.length} predictions for ${SENTIMENT_CACHE_TTL}s`);
        }

        // Calculate sentiment scores with time weighting
        const sentimentMap = calculateSentiment(predictions, predictionIntervalMinutes);

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
            predictionIntervalMinutes,
        };
    } catch (error) {
        console.error("Error calculating coin sentiment (cached):", error);
        return {
            success: false,
            error: "Failed to calculate coin sentiment",
        };
    }
});
