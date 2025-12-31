/**
 * Map of incorrect/truncated CoinGecko IDs to their correct values.
 * This handles cases where the AI submitted shortened IDs.
 */
const COINGECKO_ID_CORRECTIONS: Record<string, string> = {
    'canton': 'canton-network',  // CC coin - correct ID is canton-network
};

/**
 * Fetch historical price directly from CoinGecko WITHOUT caching.
 * Use this for resolution to ensure we always get fresh data.
 * 
 * CoinGecko granularity:
 * - Within 24 hours: 5-minute intervals
 * - 1-90 days: hourly intervals
 * - Beyond 90 days: daily intervals
 * 
 * @param coingeckoId - The CoinGecko ID (e.g., "bitcoin", "storj") - NOT the symbol
 * @param timestamp - Unix timestamp in seconds
 * @returns Price in USD or null if unavailable
 */
export async function fetchHistoricalPriceForResolution(
    coingeckoId: string,
    timestamp: number
): Promise<number | null> {
    try {
        // Apply ID corrections for known mismatches
        const correctedId = COINGECKO_ID_CORRECTIONS[coingeckoId.toLowerCase()] || coingeckoId;
        if (correctedId !== coingeckoId) {
            console.log(`🔄 Corrected CoinGecko ID: ${coingeckoId} → ${correctedId}`);
        }
        
        const apiKey = process.env.COINGECKO_API_KEY;
        const now = Math.floor(Date.now() / 1000);
        const age = now - timestamp;

        // Determine buffer and acceptable diff based on data age
        // CoinGecko provides 5-min granularity within 24h, hourly for 1-90 days
        const TWENTY_FOUR_HOURS = 24 * 60 * 60;
        const isWithin24Hours = age <= TWENTY_FOUR_HOURS;

        // Use tight buffer for recent data (5-min granularity), wider for older data
        const bufferSeconds = isWithin24Hours ? 5 * 60 : 60 * 60; // 5 min or 1 hour
        const maxAcceptableDiffMs = isWithin24Hours ? 10 * 60 * 1000 : 2 * 60 * 60 * 1000; // 10 min or 2 hours

        const fromTimestamp = timestamp - bufferSeconds;
        const toTimestamp = timestamp + bufferSeconds;

        // Build API URL - using correctedId
        const baseUrl = 'https://api.coingecko.com/api/v3';
        const endpoint = `/coins/${correctedId}/market_chart/range`;
        const params = new URLSearchParams({
            vs_currency: 'usd',
            from: fromTimestamp.toString(),
            to: toTimestamp.toString(),
        });

        const url = `${baseUrl}${endpoint}?${params}${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;

        console.log(`\n📡 [Resolution] Fetching from CoinGecko: ${correctedId}`);
        console.log(`   Target timestamp: ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
        console.log(`   Age: ${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m`);
        console.log(`   Granularity: ${isWithin24Hours ? '5-minute (within 24h)' : 'hourly (>24h)'}`);
        console.log(`   Buffer: ±${bufferSeconds / 60} minutes`);
        console.log(`   API URL: ${url.replace(apiKey || '', 'API_KEY_HIDDEN')}`);

        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 429) {
                console.error('⚠️ CoinGecko rate limit hit');
            } else if (response.status === 404) {
                console.error(`⚠️ Coin not found on CoinGecko: ${correctedId}`);
            } else {
                console.error(`⚠️ CoinGecko API error: ${response.status} ${response.statusText}`);
            }
            return null;
        }

        const data = await response.json();

        // CoinGecko returns { prices: [[timestamp_ms, price], ...] }
        if (!data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
            console.warn(`⚠️ No price data returned for ${correctedId}`);
            return null;
        }

        // Find the price closest to our target timestamp
        const targetMs = timestamp * 1000;
        let closest = data.prices[0];
        let minDiff = Math.abs(data.prices[0][0] - targetMs);

        for (const [ts, price] of data.prices) {
            const diff = Math.abs(ts - targetMs);
            if (diff < minDiff) {
                minDiff = diff;
                closest = [ts, price];
            }
        }

        // Validate the price is within acceptable range
        if (minDiff > maxAcceptableDiffMs) {
            console.warn(`⚠️ Closest price is ${Math.floor(minDiff / 60000)}min away, exceeds ${Math.floor(maxAcceptableDiffMs / 60000)}min threshold`);
            return null;
        }

        const timeDiffMin = Math.floor(minDiff / 60000);
        const timeDiffSec = Math.floor(minDiff / 1000);
        console.log(`✅ [Resolution] Found price: $${closest[1]}`);
        console.log(`   Timestamp: ${closest[0]} (${new Date(closest[0]).toISOString()})`);
        console.log(`   Time diff: ${timeDiffMin}min ${timeDiffSec % 60}s from target`);
        console.log(`   Total data points received: ${data.prices.length}`);
        
        return closest[1];
    } catch (error) {
        console.error(`❌ Error fetching resolution price from CoinGecko:`, error);
        return null;
    }
}



