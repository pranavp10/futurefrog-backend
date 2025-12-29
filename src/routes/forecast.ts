import { Elysia, t } from "elysia";
import { Connection } from "@solana/web3.js";
import { db } from "../db";
import { userPredictionsSnapshots, coinMetadata } from "../db/schema";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { fetchAllUserPredictions, type UserPredictions } from "../lib/solana-predictions";

interface HistoricalDataPoint {
    time: string;
    price: number;
}

interface PredictedDataPoint {
    time: string;
    price: number;
    predictionCount: number;
    direction: 'up' | 'down' | 'mixed';
}

interface ForecastResponse {
    coingeckoId: string;
    intervalMinutes: number;
    currentPrice: number;
    currentTime: string;
    historical: HistoricalDataPoint[];
    predicted: PredictedDataPoint[];
}

/**
 * Fetch historical price data from CoinGecko
 */
async function fetchHistoricalPrices(
    coingeckoId: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<HistoricalDataPoint[]> {
    try {
        const apiKey = process.env.COINGECKO_API_KEY;
        const baseUrl = 'https://api.coingecko.com/api/v3';
        const endpoint = `/coins/${coingeckoId}/market_chart/range`;
        const params = new URLSearchParams({
            vs_currency: 'usd',
            from: fromTimestamp.toString(),
            to: toTimestamp.toString(),
        });

        const url = `${baseUrl}${endpoint}?${params}${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;
        
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`CoinGecko API error: ${response.status}`);
            return [];
        }

        const data = await response.json();

        if (!data.prices || !Array.isArray(data.prices)) {
            return [];
        }

        // Convert to our format
        return data.prices.map(([timestamp, price]: [number, number]) => ({
            time: new Date(timestamp).toISOString(),
            price: price,
        }));
    } catch (error) {
        console.error('Error fetching historical prices:', error);
        return [];
    }
}

/**
 * Get current price from CoinGecko
 */
async function getCurrentPrice(coingeckoId: string): Promise<number | null> {
    try {
        const apiKey = process.env.COINGECKO_API_KEY;
        const baseUrl = 'https://api.coingecko.com/api/v3';
        const endpoint = `/simple/price`;
        const params = new URLSearchParams({
            ids: coingeckoId,
            vs_currencies: 'usd',
        });

        const url = `${baseUrl}${endpoint}?${params}${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;
        
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`CoinGecko API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        return data[coingeckoId]?.usd || null;
    } catch (error) {
        console.error('Error fetching current price:', error);
        return null;
    }
}

export const forecastRoutes = new Elysia({ prefix: "/forecast" })
    // Get list of assets with active (unresolved) predictions from chain
    .get("/active-assets", async () => {
        try {
            const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const connection = new Connection(rpcUrl, "confirmed");

            console.log("📡 Fetching active predictions from blockchain...");
            const allUserPredictions = await fetchAllUserPredictions(connection);

            // Collect unique symbols with active predictions (timestamp > 0 and resolution_price == 0)
            const activeSymbols = new Set<string>();

            for (const { predictions } of allUserPredictions) {
                // Check top performers
                for (let i = 0; i < 5; i++) {
                    const symbol = predictions.topPerformer[i];
                    const timestamp = predictions.topPerformerTimestamps[i];
                    const resolutionPrice = predictions.topPerformerResolutionPrices[i];
                    
                    // Active = has symbol, has timestamp, no resolution price yet
                    if (symbol && symbol.trim() !== '' && timestamp > 0 && resolutionPrice === 0) {
                        activeSymbols.add(symbol);
                    }
                }

                // Check worst performers
                for (let i = 0; i < 5; i++) {
                    const symbol = predictions.worstPerformer[i];
                    const timestamp = predictions.worstPerformerTimestamps[i];
                    const resolutionPrice = predictions.worstPerformerResolutionPrices[i];
                    
                    if (symbol && symbol.trim() !== '' && timestamp > 0 && resolutionPrice === 0) {
                        activeSymbols.add(symbol);
                    }
                }
            }

            const symbols = Array.from(activeSymbols);
            console.log(`✅ Found ${symbols.length} assets with active predictions:`, symbols);

            // Fetch metadata for these symbols
            const metadata = symbols.length > 0
                ? await db
                    .select()
                    .from(coinMetadata)
                    .where(inArray(coinMetadata.coingeckoId, symbols))
                : [];

            // Create metadata map
            const metadataMap = new Map(
                metadata.map(m => [m.coingeckoId, m])
            );

            // Build response with metadata
            const assets = symbols.map(symbol => {
                const meta = metadataMap.get(symbol);
                return {
                    coingeckoId: symbol,
                    name: meta?.name || symbol,
                    symbol: meta?.symbol?.toUpperCase() || symbol.toUpperCase(),
                    imageUrl: meta?.imageUrl || null,
                };
            });

            return {
                success: true,
                data: assets,
                count: assets.length,
            };
        } catch (error) {
            console.error('Error fetching active assets:', error);
            return {
                success: false,
                error: 'Failed to fetch active assets',
            };
        }
    })
    // Now accepts CoinGecko ID directly (e.g., "bitcoin", "ethereum", "storj")
    // Future predictions come from on-chain data, historical from CoinGecko
    .get("/:coingeckoId", async ({ params }) => {
        const { coingeckoId } = params;

        try {
            // Get prediction interval from env
            const predictionIntervalMinutes = parseInt(process.env.PREDICTION_INTERVAL_MINUTES || '60');
            const intervalMs = predictionIntervalMinutes * 60 * 1000;
            const now = Date.now();

            // Fetch current price using CoinGecko ID directly
            const currentPrice = await getCurrentPrice(coingeckoId);
            if (!currentPrice) {
                return {
                    success: false,
                    error: `Failed to fetch current price for ${coingeckoId}. Make sure it's a valid CoinGecko ID.`,
                };
            }

            // Fetch historical prices (past INTERVAL minutes)
            const historicalFrom = Math.floor((now - intervalMs) / 1000);
            const historicalTo = Math.floor(now / 1000);
            const historical = await fetchHistoricalPrices(coingeckoId, historicalFrom, historicalTo);

            // Fetch active predictions from blockchain
            const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const connection = new Connection(rpcUrl, "confirmed");
            const allUserPredictions = await fetchAllUserPredictions(connection);

            // Collect active predictions for this coingeckoId from chain
            // Active = timestamp > 0 AND resolution_price == 0
            interface ChainPrediction {
                priceAtPrediction: number;  // Price with 9 decimals
                predictedPercentage: number;
                predictionType: 'top_performer' | 'worst_performer';
                timestamp: number;
                duration: number;
            }

            const activePredictions: ChainPrediction[] = [];

            for (const { predictions } of allUserPredictions) {
                // Check top performers
                for (let i = 0; i < 5; i++) {
                    const symbol = predictions.topPerformer[i];
                    const timestamp = predictions.topPerformerTimestamps[i];
                    const resolutionPrice = predictions.topPerformerResolutionPrices[i];
                    const price = predictions.topPerformerPrices[i];
                    const percentage = predictions.topPerformerPercentages[i];
                    const duration = predictions.topPerformerDurations[i];
                    
                    // Check if this is an active prediction for the requested coin
                    if (symbol === coingeckoId && timestamp > 0 && resolutionPrice === 0 && price > 0) {
                        activePredictions.push({
                            priceAtPrediction: price,
                            predictedPercentage: percentage,
                            predictionType: 'top_performer',
                            timestamp,
                            duration,
                        });
                    }
                }

                // Check worst performers
                for (let i = 0; i < 5; i++) {
                    const symbol = predictions.worstPerformer[i];
                    const timestamp = predictions.worstPerformerTimestamps[i];
                    const resolutionPrice = predictions.worstPerformerResolutionPrices[i];
                    const price = predictions.worstPerformerPrices[i];
                    const percentage = predictions.worstPerformerPercentages[i];
                    const duration = predictions.worstPerformerDurations[i];
                    
                    if (symbol === coingeckoId && timestamp > 0 && resolutionPrice === 0 && price > 0) {
                        activePredictions.push({
                            priceAtPrediction: price,
                            predictedPercentage: percentage,
                            predictionType: 'worst_performer',
                            timestamp,
                            duration,
                        });
                    }
                }
            }

            console.log(`Found ${activePredictions.length} active on-chain predictions for ${coingeckoId}`);

            // Calculate future prices and group by time buckets
            const timeBuckets = new Map<string, { prices: number[]; directions: string[] }>();

            for (const prediction of activePredictions) {
                // Convert price from 9 decimals to actual price
                const priceAtPrediction = prediction.priceAtPrediction / 1_000_000_000;
                const predictedPercentage = prediction.predictedPercentage;
                
                // Calculate future price based on prediction
                let percentage = predictedPercentage;
                if (prediction.predictionType === 'worst_performer') {
                    percentage = -Math.abs(percentage); // Ensure negative for bearish
                } else {
                    percentage = Math.abs(percentage); // Ensure positive for bullish
                }

                const futurePrice = priceAtPrediction * (1 + percentage / 100);

                // Calculate resolution time (prediction timestamp + duration)
                const resolutionTimeMs = (prediction.timestamp + prediction.duration) * 1000;
                const resolutionTime = new Date(resolutionTimeMs);
                
                // Round to nearest minute for bucketing
                resolutionTime.setSeconds(0, 0);
                const bucketKey = resolutionTime.toISOString();

                if (!timeBuckets.has(bucketKey)) {
                    timeBuckets.set(bucketKey, { prices: [], directions: [] });
                }

                const bucket = timeBuckets.get(bucketKey)!;
                bucket.prices.push(futurePrice);
                bucket.directions.push(prediction.predictionType);
            }

            // Convert buckets to predicted data points
            const predicted: PredictedDataPoint[] = Array.from(timeBuckets.entries())
                .map(([time, data]) => {
                    // Average the prices in this bucket
                    const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length;
                    
                    // Determine overall direction
                    const upCount = data.directions.filter(d => d === 'top_performer').length;
                    const downCount = data.directions.filter(d => d === 'worst_performer').length;
                    const direction = upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'mixed';

                    return {
                        time,
                        price: avgPrice,
                        predictionCount: data.prices.length,
                        direction,
                    };
                })
                .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

            const response: ForecastResponse = {
                coingeckoId,
                intervalMinutes: predictionIntervalMinutes,
                currentPrice,
                currentTime: new Date(now).toISOString(),
                historical,
                predicted,
            };

            return {
                success: true,
                data: response,
            };
        } catch (error) {
            console.error('Error generating forecast:', error);
            return {
                success: false,
                error: 'Failed to generate forecast',
            };
        }
    }, {
        params: t.Object({
            coingeckoId: t.String()
        })
    });

