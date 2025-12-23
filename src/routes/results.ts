import { Elysia } from 'elysia';
import { db } from '../db';
import { cryptoPerformanceLogs } from '../db/schema';
import { desc, eq } from 'drizzle-orm';

/**
 * Results routes - fetch round results with top gainers and worst performers
 */
export const resultsRoutes = new Elysia({ prefix: '/api/results' })
    // Get latest round results
    .get('/', async ({ set }) => {
        try {
            // Get the latest record to find the most recent round
            const latestRecord = await db
                .select({
                    roundId: cryptoPerformanceLogs.roundId,
                    snapshotTimestamp: cryptoPerformanceLogs.snapshotTimestamp,
                })
                .from(cryptoPerformanceLogs)
                .orderBy(desc(cryptoPerformanceLogs.snapshotTimestamp))
                .limit(1);

            if (latestRecord.length === 0) {
                set.status = 404;
                return {
                    success: false,
                    error: 'No rounds available. Please trigger a snapshot first.',
                };
            }

            const roundId = latestRecord[0].roundId;

            // Get all records for this round
            const roundData = await db
                .select()
                .from(cryptoPerformanceLogs)
                .where(eq(cryptoPerformanceLogs.roundId, roundId))
                .orderBy(cryptoPerformanceLogs.performanceRank);

            const topGainers = roundData
                .filter(r => r.performanceCategory === 'top_gainer')
                .sort((a, b) => a.performanceRank - b.performanceRank);

            const worstPerformers = roundData
                .filter(r => r.performanceCategory === 'worst_performer')
                .sort((a, b) => a.performanceRank - b.performanceRank);

            return {
                success: true,
                roundId,
                snapshotTimestamp: latestRecord[0].snapshotTimestamp.toISOString(),
                topGainers: topGainers.map(r => ({
                    rank: r.performanceRank,
                    symbol: r.symbol,
                    name: r.name,
                    image: r.imageUrl,
                    price: parseFloat(r.currentPrice),
                    priceChange24h: parseFloat(r.priceChangePercentage24h),
                })),
                worstPerformers: worstPerformers.map(r => ({
                    rank: r.performanceRank,
                    symbol: r.symbol,
                    name: r.name,
                    image: r.imageUrl,
                    price: parseFloat(r.currentPrice),
                    priceChange24h: parseFloat(r.priceChangePercentage24h),
                })),
            };
        } catch (error) {
            console.error('Error fetching results:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch results',
            };
        }
    })
    // Get list of all rounds
    .get('/rounds', async ({ set }) => {
        try {
            // Get all records and group by roundId in JS
            const allRecords = await db
                .select({
                    roundId: cryptoPerformanceLogs.roundId,
                    snapshotTimestamp: cryptoPerformanceLogs.snapshotTimestamp,
                })
                .from(cryptoPerformanceLogs)
                .orderBy(desc(cryptoPerformanceLogs.snapshotTimestamp));

            // Get unique rounds
            const roundMap = new Map<string, Date>();
            for (const record of allRecords) {
                if (!roundMap.has(record.roundId)) {
                    roundMap.set(record.roundId, record.snapshotTimestamp);
                }
            }

            const rounds = Array.from(roundMap.entries())
                .slice(0, 10)
                .map(([roundId, snapshotTimestamp]) => ({
                    roundId,
                    snapshotTimestamp: snapshotTimestamp.toISOString(),
                }));

            return {
                success: true,
                rounds,
            };
        } catch (error) {
            console.error('Error fetching rounds:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch rounds',
            };
        }
    })
    // Get specific round results
    .get('/:roundId', async ({ params, set }) => {
        try {
            const { roundId } = params;

            const roundData = await db
                .select()
                .from(cryptoPerformanceLogs)
                .where(eq(cryptoPerformanceLogs.roundId, roundId))
                .orderBy(cryptoPerformanceLogs.performanceRank);

            if (roundData.length === 0) {
                set.status = 404;
                return {
                    success: false,
                    error: 'Round not found',
                };
            }

            const topGainers = roundData
                .filter(r => r.performanceCategory === 'top_gainer')
                .sort((a, b) => a.performanceRank - b.performanceRank);

            const worstPerformers = roundData
                .filter(r => r.performanceCategory === 'worst_performer')
                .sort((a, b) => a.performanceRank - b.performanceRank);

            return {
                success: true,
                roundId,
                snapshotTimestamp: roundData[0].snapshotTimestamp.toISOString(),
                topGainers: topGainers.map(r => ({
                    rank: r.performanceRank,
                    symbol: r.symbol,
                    name: r.name,
                    image: r.imageUrl,
                    price: parseFloat(r.currentPrice),
                    priceChange24h: parseFloat(r.priceChangePercentage24h),
                })),
                worstPerformers: worstPerformers.map(r => ({
                    rank: r.performanceRank,
                    symbol: r.symbol,
                    name: r.name,
                    image: r.imageUrl,
                    price: parseFloat(r.currentPrice),
                    priceChange24h: parseFloat(r.priceChangePercentage24h),
                })),
            };
        } catch (error) {
            console.error('Error fetching round:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch round',
            };
        }
    });
