import { db } from '../db';
import { cryptoMarketCache, cryptoPriceHistory } from '../db/schema';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

interface CoinGeckoCoin {
    id: string;
    symbol: string;
    name: string;
    image: string;
    current_price: number;
    market_cap: number | null;
    market_cap_rank: number | null;
    total_volume: number | null;
    price_change_percentage_24h: number;
}

let isRunning = false;

/**
 * Fetch coin data from CoinGecko and store in database
 * This runs every 30 seconds to keep prices fresh
 */
async function fetchAndCacheCryptoData(): Promise<void> {
    // Prevent overlapping runs
    if (isRunning) {
        console.log('[Crypto Cache] Previous run still in progress, skipping...');
        return;
    }

    isRunning = true;
    const startTime = Date.now();

    try {
        const apiKey = process.env.COINGECKO_API_KEY;
        const roundId = randomUUID();
        const snapshotTimestamp = new Date();

        console.log(`\n[Crypto Cache] Starting refresh at ${snapshotTimestamp.toISOString()}`);

        // Fetch from CoinGecko API
        const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`
        );

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
        }

        const coins: CoinGeckoCoin[] = await response.json();
        console.log(`[Crypto Cache] Fetched ${coins.length} coins from CoinGecko`);

        // Add volume rank
        const rankedCoins = coins.map((coin, index) => ({
            ...coin,
            volume_rank: index + 1,
        }));

        // Prepare cache records
        const cacheRecords = rankedCoins.map(coin => ({
            roundId,
            coingeckoId: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            imageUrl: coin.image,
            currentPrice: coin.current_price.toString(),
            marketCap: coin.market_cap?.toString() || null,
            marketCapRank: coin.market_cap_rank || null,
            totalVolume: coin.total_volume?.toString() || null,
            volumeRank: coin.volume_rank,
            priceChangePercentage24h: coin.price_change_percentage_24h.toString(),
            snapshotTimestamp,
        }));

        // Insert new records
        await db.insert(cryptoMarketCache).values(cacheRecords);

        // Delete old records from previous rounds
        await db
            .delete(cryptoMarketCache)
            .where(sql`${cryptoMarketCache.roundId} != ${roundId}`);

        // Also store price history for sparklines (top 50 by volume)
        const historyRecords = rankedCoins.slice(0, 50).map(coin => ({
            roundId,
            coingeckoId: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            imageUrl: coin.image,
            currentPrice: coin.current_price.toString(),
            marketCap: coin.market_cap?.toString() || null,
            marketCapRank: coin.market_cap_rank || null,
            totalVolume: coin.total_volume?.toString() || null,
            volumeRank: coin.volume_rank,
            priceChangePercentage24h: coin.price_change_percentage_24h.toString(),
            snapshotTimestamp,
        }));

        await db.insert(cryptoPriceHistory).values(historyRecords);

        // Clean up old price history (keep last 24 hours only)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await db
            .delete(cryptoPriceHistory)
            .where(sql`${cryptoPriceHistory.snapshotTimestamp} < ${twentyFourHoursAgo.toISOString()}`);

        const duration = Date.now() - startTime;
        console.log(`[Crypto Cache] ✅ Refreshed ${cacheRecords.length} coins in ${duration}ms`);

    } catch (error) {
        console.error('[Crypto Cache] ❌ Error:', error);
    } finally {
        isRunning = false;
    }
}

/**
 * Start the crypto data cron job
 * Runs every 30 seconds
 */
export function startCryptoCacheCron(): void {
    const intervalMs = 30 * 1000; // 30 seconds

    console.log('[Crypto Cache] Starting cron job (every 30 seconds)');

    // Run immediately on start
    fetchAndCacheCryptoData();

    // Then run every 30 seconds
    setInterval(fetchAndCacheCryptoData, intervalMs);
}

/**
 * Manually trigger a cache refresh
 */
export async function triggerCacheRefresh(): Promise<void> {
    await fetchAndCacheCryptoData();
}
