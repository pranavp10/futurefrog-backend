import { getRedisClient } from './redis';

const PRICE_CACHE_PREFIX = 'price:';
const PRICE_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

interface PriceDataPoint {
    timestamp: number; // milliseconds
    price: number;
}

/**
 * Get historical price for a cryptocurrency at a specific timestamp
 * @param coingeckoId - CoinGecko ID (e.g., "bitcoin", "ethereum")
 * @param timestamp - Unix timestamp in seconds
 * @returns Price in USD or null if unavailable
 */
export async function getHistoricalPrice(
    coingeckoId: string,
    timestamp: number
): Promise<number | null> {
    try {
        // Check Redis cache first
        const cacheKey = `${PRICE_CACHE_PREFIX}${coingeckoId}:${timestamp}`;
        const redis = getRedisClient();
        const cachedPrice = await redis.get(cacheKey);

        if (cachedPrice) {
            console.log(`💰 Cache hit for ${coingeckoId} at ${timestamp}`);
            return parseFloat(cachedPrice);
        }

        console.log(`🔍 Cache miss, fetching price for ${coingeckoId} at ${timestamp}`);

        // Fetch from CoinGecko API
        const price = await fetchPriceFromCoinGecko(coingeckoId, timestamp);

        if (price !== null) {
            // Cache the result
            await redis.setex(cacheKey, PRICE_CACHE_TTL, price.toString());
            console.log(`✅ Cached price for ${coingeckoId} at ${timestamp}: $${price}`);
        }

        return price;
    } catch (error) {
        console.error(`❌ Error getting historical price for ${coingeckoId}:`, error);
        return null;
    }
}

/**
 * Fetch price from CoinGecko market_chart/range API
 * Automatically handles granularity based on timestamp age
 */
async function fetchPriceFromCoinGecko(
    coingeckoId: string,
    timestamp: number
): Promise<number | null> {
    try {
        const apiKey = process.env.COINGECKO_API_KEY;
        const now = Math.floor(Date.now() / 1000);
        const age = now - timestamp;

        // CoinGecko requires timestamps in seconds, but we need some buffer
        // Add ±1 hour buffer to ensure we get data points around the target time
        const bufferSeconds = 60 * 60; // 1 hour
        const fromTimestamp = timestamp - bufferSeconds;
        const toTimestamp = timestamp + bufferSeconds;

        // Build API URL
        const baseUrl = 'https://api.coingecko.com/api/v3';
        const endpoint = `/coins/${coingeckoId}/market_chart/range`;
        const params = new URLSearchParams({
            vs_currency: 'usd',
            from: fromTimestamp.toString(),
            to: toTimestamp.toString(),
        });

        const url = `${baseUrl}${endpoint}?${params}${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;

        console.log(`📡 Fetching from CoinGecko: ${coingeckoId} (age: ${Math.floor(age / 3600)}h)`);

        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 429) {
                console.error('⚠️ CoinGecko rate limit hit');
            } else if (response.status === 404) {
                console.error(`⚠️ Coin not found: ${coingeckoId}`);
            } else {
                console.error(`⚠️ CoinGecko API error: ${response.status} ${response.statusText}`);
            }
            return null;
        }

        const data = await response.json();

        // CoinGecko returns { prices: [[timestamp_ms, price], ...] }
        if (!data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
            console.warn(`⚠️ No price data returned for ${coingeckoId}`);
            return null;
        }

        // Find the price closest to our target timestamp
        const targetMs = timestamp * 1000; // Convert to milliseconds
        const priceDataPoints: PriceDataPoint[] = data.prices.map(([ts, price]: [number, number]) => ({
            timestamp: ts,
            price: price,
        }));

        const closestPrice = findClosestPrice(priceDataPoints, targetMs);

        if (closestPrice) {
            const timeDiff = Math.abs(closestPrice.timestamp - targetMs) / 1000 / 60; // in minutes
            console.log(`📊 Found price: $${closestPrice.price} (${timeDiff.toFixed(0)}min difference)`);
            return closestPrice.price;
        }

        console.warn(`⚠️ Could not find close enough price for ${coingeckoId} at ${timestamp}`);
        return null;
    } catch (error) {
        console.error(`❌ Error fetching from CoinGecko:`, error);
        return null;
    }
}

/**
 * Find the price data point closest to the target timestamp
 */
function findClosestPrice(
    dataPoints: PriceDataPoint[],
    targetTimestamp: number
): PriceDataPoint | null {
    if (dataPoints.length === 0) return null;

    let closest = dataPoints[0];
    let minDiff = Math.abs(dataPoints[0].timestamp - targetTimestamp);

    for (const point of dataPoints) {
        const diff = Math.abs(point.timestamp - targetTimestamp);
        if (diff < minDiff) {
            minDiff = diff;
            closest = point;
        }
    }

    // Only return if the price is within reasonable time range (e.g., 2 hours)
    const maxDiffMs = 2 * 60 * 60 * 1000; // 2 hours
    if (minDiff <= maxDiffMs) {
        return closest;
    }

    return null;
}

/**
 * Batch fetch historical prices for multiple predictions
 * This is more efficient than calling getHistoricalPrice multiple times
 * @param requests - Array of {coingeckoId, timestamp} objects
 * @returns Map of cache keys to prices
 */
export async function batchGetHistoricalPrices(
    requests: Array<{ coingeckoId: string; timestamp: number }>
): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();

    // Fetch all prices in parallel
    const promises = requests.map(async (req) => {
        const key = `${req.coingeckoId}:${req.timestamp}`;
        const price = await getHistoricalPrice(req.coingeckoId, req.timestamp);
        results.set(key, price);
    });

    await Promise.all(promises);

    return results;
}


