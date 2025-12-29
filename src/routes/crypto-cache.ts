import { Elysia } from 'elysia';
import { db } from '../db';
import { cryptoMarketCache, cryptoPriceHistory } from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';

interface SparklineData {
    [coingeckoId: string]: number[];
}

/**
 * Fetch sparkline data from the crypto_price_history table
 * Returns a map of coingeckoId -> price array (last 24 hours of data points)
 * Uses the historical data stored from snapshot runs instead of calling CoinGecko API
 */
async function fetchSparklineData(coinIds: string[]): Promise<SparklineData> {
    try {
        if (coinIds.length === 0) {
            return {};
        }

        // Get data from the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Query the crypto_price_history table for price data
        const historyData = await db
            .select({
                coingeckoId: cryptoPriceHistory.coingeckoId,
                currentPrice: cryptoPriceHistory.currentPrice,
                snapshotTimestamp: cryptoPriceHistory.snapshotTimestamp,
            })
            .from(cryptoPriceHistory)
            .where(
                sql`${cryptoPriceHistory.coingeckoId} = ANY(${coinIds}) AND ${cryptoPriceHistory.snapshotTimestamp} >= ${twentyFourHoursAgo}`
            )
            .orderBy(cryptoPriceHistory.coingeckoId, cryptoPriceHistory.snapshotTimestamp);

        // Group by coingeckoId and build sparkline arrays
        const sparklineMap: SparklineData = {};

        for (const record of historyData) {
            const coinId = record.coingeckoId;
            if (!sparklineMap[coinId]) {
                sparklineMap[coinId] = [];
            }
            sparklineMap[coinId].push(parseFloat(record.currentPrice));
        }

        // Ensure we have at least 2 data points for each coin (for meaningful chart)
        // If we have less, we'll return empty for that coin so the frontend can generate fallback
        for (const coinId of Object.keys(sparklineMap)) {
            if (sparklineMap[coinId].length < 2) {
                delete sparklineMap[coinId];
            }
        }

        return sparklineMap;
    } catch (error) {
        console.error('Error fetching sparkline data from database:', error);
        return {};
    }
}

/**
 * Crypto cache routes
 * Serves cached cryptocurrency data from the database instead of calling CoinGecko API
 * Data is updated by the crypto snapshot process
 */
export const cryptoCacheRoutes = new Elysia({ prefix: '/api/crypto-cache' })
    .get('/', async ({ set, query }) => {
        try {
            const includeSparklines = query.sparklines === 'true';

            // Get the latest roundId first (by most recent snapshotTimestamp)
            const latestRound = await db
                .select({
                    roundId: cryptoMarketCache.roundId,
                    snapshotTimestamp: cryptoMarketCache.snapshotTimestamp,
                })
                .from(cryptoMarketCache)
                .orderBy(desc(cryptoMarketCache.snapshotTimestamp))
                .limit(1);

            if (latestRound.length === 0) {
                set.status = 404;
                return {
                    success: false,
                    error: 'No cached data available. Please run a snapshot first.',
                    message: 'Trigger a snapshot via POST /api/trigger-snapshot',
                };
            }

            const latestRoundId = latestRound[0].roundId;

            // Get all cached crypto data for the latest round only
            const cachedData = await db
                .select()
                .from(cryptoMarketCache)
                .where(eq(cryptoMarketCache.roundId, latestRoundId))
                .orderBy(desc(cryptoMarketCache.volumeRank));

            if (cachedData.length === 0) {
                set.status = 404;
                return {
                    success: false,
                    error: 'No cached data available for latest round.',
                };
            }

            // Fetch sparkline data if requested
            let sparklineData: SparklineData = {};
            if (includeSparklines) {
                const coinIds = cachedData.map(coin => coin.coingeckoId);
                sparklineData = await fetchSparklineData(coinIds);
            }

            // Transform to match the CoinGecko API format for backward compatibility
            const formattedData = cachedData.map(coin => ({
                id: coin.coingeckoId,
                symbol: coin.symbol,
                name: coin.name,
                image: coin.imageUrl,
                current_price: parseFloat(coin.currentPrice),
                market_cap: coin.marketCap ? parseFloat(coin.marketCap) : null,
                market_cap_rank: coin.marketCapRank,
                total_volume: coin.totalVolume ? parseFloat(coin.totalVolume) : null,
                price_change_percentage_24h: parseFloat(coin.priceChangePercentage24h),
                volume_rank: coin.volumeRank,
                ...(includeSparklines && sparklineData[coin.coingeckoId] ? {
                    sparkline_in_7d: {
                        price: sparklineData[coin.coingeckoId],
                    },
                } : {}),
            }));

            // Get metadata from the first record
            const metadata = cachedData[0];

            return {
                success: true,
                data: formattedData,
                count: formattedData.length,
                timestamp: metadata.snapshotTimestamp.toISOString(),
                roundId: metadata.roundId,
                source: 'cache',
            };
        } catch (error) {
            console.error('Error fetching crypto cache:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch cached crypto data',
            };
        }
    })
    .get('/metadata', async ({ set }) => {
        try {
            // Get metadata about the latest cached data
            const firstRecord = await db
                .select({
                    roundId: cryptoMarketCache.roundId,
                    snapshotTimestamp: cryptoMarketCache.snapshotTimestamp,
                    createdAt: cryptoMarketCache.createdAt,
                })
                .from(cryptoMarketCache)
                .orderBy(desc(cryptoMarketCache.snapshotTimestamp))
                .limit(1);

            if (firstRecord.length === 0) {
                set.status = 404;
                return {
                    success: false,
                    error: 'No cached data available',
                };
            }

            const latestRoundId = firstRecord[0].roundId;

            // Count records in latest round only
            const roundRecords = await db
                .select()
                .from(cryptoMarketCache)
                .where(eq(cryptoMarketCache.roundId, latestRoundId));

            return {
                success: true,
                roundId: firstRecord[0].roundId,
                snapshotTimestamp: firstRecord[0].snapshotTimestamp.toISOString(),
                cacheCreatedAt: firstRecord[0].createdAt.toISOString(),
                totalRecords: roundRecords.length,
            };
        } catch (error) {
            console.error('Error fetching cache metadata:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch cache metadata',
            };
        }
    });






