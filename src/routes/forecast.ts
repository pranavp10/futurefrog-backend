import { Elysia, t } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { getCoingeckoIdFromSymbol } from "../lib/redis";

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
    symbol: string;
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
    .get("/:symbol", async ({ params }) => {
        const { symbol } = params;
        const symbolUpper = symbol.toUpperCase();

        try {
            // Get prediction interval from env
            const predictionIntervalMinutes = parseInt(process.env.PREDICTION_INTERVAL_MINUTES || '60');
            const intervalMs = predictionIntervalMinutes * 60 * 1000;
            const now = Date.now();

            // Get CoinGecko ID for this symbol
            const coingeckoId = await getCoingeckoIdFromSymbol(symbolUpper);
            if (!coingeckoId) {
                return {
                    success: false,
                    error: `Unknown symbol: ${symbolUpper}`,
                };
            }

            // Fetch current price
            const currentPrice = await getCurrentPrice(coingeckoId);
            if (!currentPrice) {
                return {
                    success: false,
                    error: `Failed to fetch current price for ${symbolUpper}`,
                };
            }

            // Fetch historical prices (past INTERVAL minutes)
            const historicalFrom = Math.floor((now - intervalMs) / 1000);
            const historicalTo = Math.floor(now / 1000);
            const historical = await fetchHistoricalPrices(coingeckoId, historicalFrom, historicalTo);

            // Query unprocessed predictions for this symbol
            const predictions = await db
                .select()
                .from(userPredictionsSnapshots)
                .where(
                    and(
                        eq(userPredictionsSnapshots.processed, false),
                        eq(userPredictionsSnapshots.symbol, symbolUpper)
                    )
                );

            console.log(`Found ${predictions.length} unprocessed predictions for ${symbolUpper}`);

            // Calculate future prices and group by 1-hour buckets
            const hourBuckets = new Map<string, { prices: number[]; directions: string[] }>();

            for (const prediction of predictions) {
                // Skip if missing required data
                if (!prediction.priceAtPrediction || !prediction.resolutionTime) {
                    continue;
                }

                const priceAtPrediction = parseFloat(prediction.priceAtPrediction);
                const predictedPercentage = prediction.predictedPercentage || 0;
                
                // Calculate future price based on prediction
                let percentage = predictedPercentage;
                if (prediction.predictionType === 'worst_performer') {
                    percentage = -Math.abs(percentage); // Ensure negative for bearish
                } else {
                    percentage = Math.abs(percentage); // Ensure positive for bullish
                }

                const futurePrice = priceAtPrediction * (1 + percentage / 100);

                // Group by 1-hour bucket based on resolution time
                const resolutionTime = new Date(prediction.resolutionTime);
                const hourBucket = new Date(resolutionTime);
                hourBucket.setMinutes(0, 0, 0); // Round down to hour
                const bucketKey = hourBucket.toISOString();

                if (!hourBuckets.has(bucketKey)) {
                    hourBuckets.set(bucketKey, { prices: [], directions: [] });
                }

                const bucket = hourBuckets.get(bucketKey)!;
                bucket.prices.push(futurePrice);
                bucket.directions.push(prediction.predictionType || 'unknown');
            }

            // Convert buckets to predicted data points
            const predicted: PredictedDataPoint[] = Array.from(hourBuckets.entries())
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
                symbol: symbolUpper,
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
            symbol: t.String()
        })
    });

