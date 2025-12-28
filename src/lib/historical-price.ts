/**
 * Fetch historical price directly from CoinGecko WITHOUT caching.
 * Use this for resolution to ensure we always get fresh data.
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
        const apiKey = process.env.COINGECKO_API_KEY;
        const now = Math.floor(Date.now() / 1000);
        const age = now - timestamp;

        // Add ±1 hour buffer to ensure we get data points around the target time
        const bufferSeconds = 60 * 60; // 1 hour
        const fromTimestamp = timestamp - bufferSeconds;
        const toTimestamp = timestamp + bufferSeconds;

        // Build API URL - using coingeckoId directly (no mapping needed)
        const baseUrl = 'https://api.coingecko.com/api/v3';
        const endpoint = `/coins/${coingeckoId}/market_chart/range`;
        const params = new URLSearchParams({
            vs_currency: 'usd',
            from: fromTimestamp.toString(),
            to: toTimestamp.toString(),
        });

        const url = `${baseUrl}${endpoint}?${params}${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;

        console.log(`📡 [Resolution] Fetching from CoinGecko: ${coingeckoId}`);
        console.log(`   Target timestamp: ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
        console.log(`   Age: ${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m`);

        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 429) {
                console.error('⚠️ CoinGecko rate limit hit');
            } else if (response.status === 404) {
                console.error(`⚠️ Coin not found on CoinGecko: ${coingeckoId}`);
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

        // Only accept if within 2 hours
        const maxDiffMs = 2 * 60 * 60 * 1000;
        if (minDiff > maxDiffMs) {
            console.warn(`⚠️ Closest price is ${Math.floor(minDiff / 60000)}min away, too far from target`);
            return null;
        }

        const timeDiffMin = Math.floor(minDiff / 60000);
        console.log(`✅ [Resolution] Found price: $${closest[1]} (${timeDiffMin}min from target)`);
        
        return closest[1];
    } catch (error) {
        console.error(`❌ Error fetching resolution price from CoinGecko:`, error);
        return null;
    }
}



