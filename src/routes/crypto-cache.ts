import { Elysia } from 'elysia';
import { db } from '../db';
import { cryptoMarketCache } from '../db/schema';
import { desc, eq } from 'drizzle-orm';

/**
 * Crypto cache routes
 * Serves cached cryptocurrency data from the database instead of calling CoinGecko API
 * Data is updated by the crypto snapshot process
 */
export const cryptoCacheRoutes = new Elysia({ prefix: '/api/crypto-cache' })
    .get('/', async ({ set }) => {
        try {
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






