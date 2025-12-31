import { Elysia } from "elysia";
import { Connection } from "@solana/web3.js";
import { redis } from "../lib/redis";
import { fetchAllUserPredictions, type UserPredictions } from "../lib/solana-predictions";

// Cache TTL in seconds (2 minutes - same as sentiment)
const COMMUNITY_PREDICTIONS_CACHE_TTL = 120;
const COMMUNITY_PREDICTIONS_CACHE_KEY = "community:predictions";

interface CommunityPrediction {
    symbol: string;
    totalPredictions: number;
    predictionsWithPercentage: number;
    topPredictions: number;
    worstPredictions: number;
    averagePercentage: number;
    bullishPercentage: number;
    bearishPercentage: number;
    confidence: "high" | "medium" | "low";
}

interface CacheData {
    predictions: Record<string, CommunityPrediction>;
    cachedAt: number;
}

/**
 * Transform blockchain predictions to community predictions format
 */
function calculateCommunityPredictions(
    allUserPredictions: Array<{ userAddress: string; predictions: UserPredictions }>
): Record<string, CommunityPrediction> {
    // Group predictions by symbol
    const symbolPredictions: Record<
        string,
        Array<{ type: "top" | "worst"; percentage: number }>
    > = {};

    for (const { predictions } of allUserPredictions) {
        // Process top performers
        for (let i = 0; i < 5; i++) {
            const symbol = predictions.topPerformer[i]?.trim().toLowerCase();
            if (symbol) {
                if (!symbolPredictions[symbol]) symbolPredictions[symbol] = [];
                symbolPredictions[symbol].push({
                    type: "top",
                    percentage: predictions.topPerformerPercentages[i] || 0,
                });
            }
        }

        // Process worst performers
        for (let i = 0; i < 5; i++) {
            const symbol = predictions.worstPerformer[i]?.trim().toLowerCase();
            if (symbol) {
                if (!symbolPredictions[symbol]) symbolPredictions[symbol] = [];
                symbolPredictions[symbol].push({
                    type: "worst",
                    percentage: predictions.worstPerformerPercentages[i] || 0,
                });
            }
        }
    }

    // Calculate community predictions for each symbol
    const communityPreds: Record<string, CommunityPrediction> = {};

    for (const [symbol, preds] of Object.entries(symbolPredictions)) {
        const topPreds = preds.filter((p) => p.type === "top");
        const worstPreds = preds.filter((p) => p.type === "worst");
        const totalPredictions = preds.length;

        // Calculate average percentage (only from predictions with explicit %)
        const allPercentages: number[] = [];
        for (const p of topPreds) {
            if (p.percentage !== 0) allPercentages.push(Math.abs(p.percentage));
        }
        for (const p of worstPreds) {
            if (p.percentage !== 0) allPercentages.push(-Math.abs(p.percentage));
        }

        const predictionsWithPercentage = allPercentages.length;
        const averagePercentage =
            predictionsWithPercentage > 0
                ? allPercentages.reduce((sum, pct) => sum + pct, 0) / predictionsWithPercentage
                : 0;

        const bullishPercentage = (topPreds.length / totalPredictions) * 100;

        let confidence: "high" | "medium" | "low";
        if (predictionsWithPercentage >= 5) confidence = "high";
        else if (predictionsWithPercentage >= 2) confidence = "medium";
        else confidence = "low";

        communityPreds[symbol] = {
            symbol,
            totalPredictions,
            predictionsWithPercentage,
            topPredictions: topPreds.length,
            worstPredictions: worstPreds.length,
            averagePercentage,
            bullishPercentage,
            bearishPercentage: 100 - bullishPercentage,
            confidence,
        };
    }

    return communityPreds;
}

/**
 * Community predictions endpoint with Redis caching
 * Returns pre-calculated prediction aggregates for all coins
 */
export const communityPredictionsRoutes = new Elysia({ prefix: "/api/community-predictions" })
    .get("/", async ({ set }) => {
        try {
            // Try to get cached data
            const cachedData = await redis.get(COMMUNITY_PREDICTIONS_CACHE_KEY);

            if (cachedData) {
                const parsed: CacheData = JSON.parse(cachedData);
                const cacheAge = Math.round((Date.now() - parsed.cachedAt) / 1000);
                
                return {
                    success: true,
                    data: parsed.predictions,
                    count: Object.keys(parsed.predictions).length,
                    cached: true,
                    cacheAge,
                };
            }

            // Cache miss - fetch from blockchain
            console.log("🔗 Community Predictions: Cache miss, fetching from blockchain...");

            const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const connection = new Connection(rpcUrl, "confirmed");

            const allUserPredictions = await fetchAllUserPredictions(connection);
            const predictions = calculateCommunityPredictions(allUserPredictions);

            // Store in cache with TTL
            const cacheData: CacheData = {
                predictions,
                cachedAt: Date.now(),
            };

            await redis.setex(
                COMMUNITY_PREDICTIONS_CACHE_KEY,
                COMMUNITY_PREDICTIONS_CACHE_TTL,
                JSON.stringify(cacheData)
            );
            
            console.log(`✅ Community Predictions: Cached ${Object.keys(predictions).length} coins for ${COMMUNITY_PREDICTIONS_CACHE_TTL}s`);

            return {
                success: true,
                data: predictions,
                count: Object.keys(predictions).length,
                cached: false,
            };
        } catch (error) {
            console.error("Error fetching community predictions:", error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to fetch community predictions",
            };
        }
    });

