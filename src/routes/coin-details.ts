import { Elysia } from 'elysia';
import { getRedisClient } from '../lib/redis';
import { db } from '../db';
import { cryptoMarketCache } from '../db/schema';
import { desc, eq } from 'drizzle-orm';

// Cache TTL in seconds (5 minutes for coin details)
const COIN_DETAILS_CACHE_TTL = 300;

interface CoinGeckoMarketData {
    id: string;
    symbol: string;
    name: string;
    image: { large: string; small: string; thumb: string };
    description?: { en: string };
    market_data: {
        current_price: { usd: number };
        market_cap: { usd: number };
        market_cap_rank: number;
        total_volume: { usd: number };
        high_24h: { usd: number };
        low_24h: { usd: number };
        price_change_24h: number;
        price_change_percentage_24h: number;
        price_change_percentage_7d?: number;
        price_change_percentage_30d?: number;
        circulating_supply: number;
        total_supply: number | null;
        max_supply: number | null;
        ath: { usd: number };
        ath_change_percentage: { usd: number };
        ath_date: { usd: string };
        atl: { usd: number };
        atl_change_percentage: { usd: number };
        atl_date: { usd: string };
    };
    links?: {
        homepage?: string[];
        blockchain_site?: string[];
        twitter_screen_name?: string;
        telegram_channel_identifier?: string;
    };
}

interface PriceHistoryPoint {
    timestamp: string;
    price: number;
}

interface CoinDetailsData {
    id: string;
    symbol: string;
    name: string;
    image: string;
    description?: string;
    current_price: number;
    market_cap: number;
    market_cap_rank: number;
    total_volume: number;
    high_24h: number;
    low_24h: number;
    price_change_24h: number;
    price_change_percentage_24h: number;
    price_change_percentage_7d?: number;
    price_change_percentage_30d?: number;
    circulating_supply: number;
    total_supply: number | null;
    max_supply: number | null;
    ath: number;
    ath_change_percentage: number;
    ath_date: string;
    atl: number;
    atl_change_percentage: number;
    atl_date: string;
    links?: {
        homepage?: string;
        twitter?: string;
        telegram?: string;
    };
    priceHistory: PriceHistoryPoint[];
    volume_rank?: number;
}

/**
 * Fetch coin details from CoinGecko API
 */
async function fetchCoinDetailsFromAPI(coinId: string): Promise<CoinGeckoMarketData | null> {
    const apiKey = process.env.COINGECKO_API_KEY;
    const baseUrl = 'https://api.coingecko.com/api/v3';

    try {
        const url = `${baseUrl}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;

        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`CoinGecko API error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching coin details from CoinGecko:', error);
        throw error;
    }
}

/**
 * Fetch 24hr price chart data from CoinGecko API
 */
async function fetchPriceChartFromAPI(coinId: string): Promise<PriceHistoryPoint[]> {
    const apiKey = process.env.COINGECKO_API_KEY;
    const baseUrl = 'https://api.coingecko.com/api/v3';

    try {
        const url = `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=1${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;

        const response = await fetch(url);

        if (!response.ok) {
            console.error(`Failed to fetch price chart: ${response.status}`);
            return [];
        }

        const data = await response.json();

        return (data.prices || []).map(([timestamp, price]: [number, number]) => ({
            timestamp: new Date(timestamp).toISOString(),
            price: price,
        }));
    } catch (error) {
        console.error('Error fetching price chart from CoinGecko:', error);
        return [];
    }
}

/**
 * Get coin ID from symbol (for lookups by symbol)
 */
async function getCoinIdFromSymbol(symbol: string): Promise<string | null> {
    // First check our cached data
    const cachedCoin = await db
        .select({
            coingeckoId: cryptoMarketCache.coingeckoId,
        })
        .from(cryptoMarketCache)
        .where(eq(cryptoMarketCache.symbol, symbol.toLowerCase()))
        .orderBy(desc(cryptoMarketCache.snapshotTimestamp))
        .limit(1);

    if (cachedCoin.length > 0) {
        return cachedCoin[0].coingeckoId;
    }

    // Fallback: Try using symbol as ID (works for most major coins)
    return symbol.toLowerCase();
}

/**
 * Get volume rank from our cached data
 */
async function getVolumeRank(coinId: string): Promise<number | null> {
    const cachedCoin = await db
        .select({
            volumeRank: cryptoMarketCache.volumeRank,
        })
        .from(cryptoMarketCache)
        .where(eq(cryptoMarketCache.coingeckoId, coinId))
        .orderBy(desc(cryptoMarketCache.snapshotTimestamp))
        .limit(1);

    return cachedCoin.length > 0 ? cachedCoin[0].volumeRank : null;
}

/**
 * Coin details route with Redis caching
 * Returns detailed coin information + 24hr price chart
 */
export const coinDetailsRoutes = new Elysia({ prefix: '/api/coin' })
    // Get coin details by ID or symbol
    .get('/:coinId', async ({ params, set }) => {
        const { coinId } = params;

        try {
            const redis = getRedisClient();
            const cacheKey = `coin:details:${coinId.toLowerCase()}`;

            // Try to get from Redis cache first
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                console.log(`📦 Cache hit for coin: ${coinId}`);
                return {
                    success: true,
                    data: JSON.parse(cachedData),
                    cached: true,
                    timestamp: new Date().toISOString(),
                };
            }

            console.log(`🔄 Cache miss for coin: ${coinId}, fetching from API...`);

            // Resolve coinId if it's a symbol
            let resolvedCoinId = coinId.toLowerCase();

            // Try fetching directly first
            let coinData = await fetchCoinDetailsFromAPI(resolvedCoinId);

            // If not found, try resolving from symbol
            if (!coinData) {
                const resolvedId = await getCoinIdFromSymbol(coinId);
                if (resolvedId && resolvedId !== resolvedCoinId) {
                    resolvedCoinId = resolvedId;
                    coinData = await fetchCoinDetailsFromAPI(resolvedCoinId);
                }
            }

            if (!coinData) {
                set.status = 404;
                return {
                    success: false,
                    error: `Coin "${coinId}" not found`,
                };
            }

            // Fetch price chart in parallel
            const priceHistory = await fetchPriceChartFromAPI(resolvedCoinId);

            // Get volume rank from our cache
            const volumeRank = await getVolumeRank(resolvedCoinId);

            // Transform the data
            const coinDetails: CoinDetailsData = {
                id: coinData.id,
                symbol: coinData.symbol.toUpperCase(),
                name: coinData.name,
                image: coinData.image?.large || coinData.image?.small || '',
                description: coinData.description?.en?.slice(0, 500), // Limit description length
                current_price: coinData.market_data.current_price.usd,
                market_cap: coinData.market_data.market_cap.usd,
                market_cap_rank: coinData.market_data.market_cap_rank,
                total_volume: coinData.market_data.total_volume.usd,
                high_24h: coinData.market_data.high_24h.usd,
                low_24h: coinData.market_data.low_24h.usd,
                price_change_24h: coinData.market_data.price_change_24h,
                price_change_percentage_24h: coinData.market_data.price_change_percentage_24h,
                price_change_percentage_7d: coinData.market_data.price_change_percentage_7d,
                price_change_percentage_30d: coinData.market_data.price_change_percentage_30d,
                circulating_supply: coinData.market_data.circulating_supply,
                total_supply: coinData.market_data.total_supply,
                max_supply: coinData.market_data.max_supply,
                ath: coinData.market_data.ath.usd,
                ath_change_percentage: coinData.market_data.ath_change_percentage.usd,
                ath_date: coinData.market_data.ath_date.usd,
                atl: coinData.market_data.atl.usd,
                atl_change_percentage: coinData.market_data.atl_change_percentage.usd,
                atl_date: coinData.market_data.atl_date.usd,
                links: {
                    homepage: coinData.links?.homepage?.[0] || undefined,
                    twitter: coinData.links?.twitter_screen_name
                        ? `https://twitter.com/${coinData.links.twitter_screen_name}`
                        : undefined,
                    telegram: coinData.links?.telegram_channel_identifier
                        ? `https://t.me/${coinData.links.telegram_channel_identifier}`
                        : undefined,
                },
                priceHistory,
                volume_rank: volumeRank ?? undefined,
            };

            // Cache in Redis
            await redis.setex(cacheKey, COIN_DETAILS_CACHE_TTL, JSON.stringify(coinDetails));
            console.log(`✅ Cached coin details for: ${coinId} (TTL: ${COIN_DETAILS_CACHE_TTL}s)`);

            return {
                success: true,
                data: coinDetails,
                cached: false,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching coin details:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch coin details',
            };
        }
    })
    // Force refresh endpoint (bypasses cache)
    .get('/:coinId/refresh', async ({ params, set }) => {
        const { coinId } = params;

        try {
            const redis = getRedisClient();
            const cacheKey = `coin:details:${coinId.toLowerCase()}`;

            // Delete existing cache
            await redis.del(cacheKey);
            console.log(`🗑️ Cleared cache for coin: ${coinId}`);

            // Resolve coinId if it's a symbol
            let resolvedCoinId = coinId.toLowerCase();
            let coinData = await fetchCoinDetailsFromAPI(resolvedCoinId);

            if (!coinData) {
                const resolvedId = await getCoinIdFromSymbol(coinId);
                if (resolvedId && resolvedId !== resolvedCoinId) {
                    resolvedCoinId = resolvedId;
                    coinData = await fetchCoinDetailsFromAPI(resolvedCoinId);
                }
            }

            if (!coinData) {
                set.status = 404;
                return {
                    success: false,
                    error: `Coin "${coinId}" not found`,
                };
            }

            // Fetch price chart
            const priceHistory = await fetchPriceChartFromAPI(resolvedCoinId);

            // Get volume rank
            const volumeRank = await getVolumeRank(resolvedCoinId);

            // Transform the data
            const coinDetails: CoinDetailsData = {
                id: coinData.id,
                symbol: coinData.symbol.toUpperCase(),
                name: coinData.name,
                image: coinData.image?.large || coinData.image?.small || '',
                description: coinData.description?.en?.slice(0, 500),
                current_price: coinData.market_data.current_price.usd,
                market_cap: coinData.market_data.market_cap.usd,
                market_cap_rank: coinData.market_data.market_cap_rank,
                total_volume: coinData.market_data.total_volume.usd,
                high_24h: coinData.market_data.high_24h.usd,
                low_24h: coinData.market_data.low_24h.usd,
                price_change_24h: coinData.market_data.price_change_24h,
                price_change_percentage_24h: coinData.market_data.price_change_percentage_24h,
                price_change_percentage_7d: coinData.market_data.price_change_percentage_7d,
                price_change_percentage_30d: coinData.market_data.price_change_percentage_30d,
                circulating_supply: coinData.market_data.circulating_supply,
                total_supply: coinData.market_data.total_supply,
                max_supply: coinData.market_data.max_supply,
                ath: coinData.market_data.ath.usd,
                ath_change_percentage: coinData.market_data.ath_change_percentage.usd,
                ath_date: coinData.market_data.ath_date.usd,
                atl: coinData.market_data.atl.usd,
                atl_change_percentage: coinData.market_data.atl_change_percentage.usd,
                atl_date: coinData.market_data.atl_date.usd,
                links: {
                    homepage: coinData.links?.homepage?.[0] || undefined,
                    twitter: coinData.links?.twitter_screen_name
                        ? `https://twitter.com/${coinData.links.twitter_screen_name}`
                        : undefined,
                    telegram: coinData.links?.telegram_channel_identifier
                        ? `https://t.me/${coinData.links.telegram_channel_identifier}`
                        : undefined,
                },
                priceHistory,
                volume_rank: volumeRank ?? undefined,
            };

            // Cache in Redis
            await redis.setex(cacheKey, COIN_DETAILS_CACHE_TTL, JSON.stringify(coinDetails));
            console.log(`✅ Refreshed and cached coin details for: ${coinId}`);

            return {
                success: true,
                data: coinDetails,
                cached: false,
                refreshed: true,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error refreshing coin details:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to refresh coin details',
            };
        }
    });

