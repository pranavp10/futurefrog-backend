import { inngest } from "./client";
import { db } from "../db";
import { cryptoPerformanceLogs } from "../db/schema";
import {
    CoinGeckoMarketData,
    filterAndRankCryptos,
} from "../lib/crypto-filters";
import { randomUUID } from "crypto";

/**
 * Scheduled job to capture crypto performance snapshots
 * Runs every X minutes as configured by CRYPTO_SNAPSHOT_FREQUENCY_MINUTES
 */
export const cryptoSnapshot = inngest.createFunction(
    { id: "crypto-snapshot" },
    {
        // Run on a schedule based on environment variable (default: every 15 minutes)
        cron: process.env.CRYPTO_SNAPSHOT_FREQUENCY_MINUTES
            ? `*/${process.env.CRYPTO_SNAPSHOT_FREQUENCY_MINUTES} * * * *`
            : "*/15 * * * *",
    },
    async ({ event, step }) => {
        const snapshotTimestamp = new Date();
        const roundId = randomUUID();

        console.log(`🐸 [Crypto Snapshot] Starting round ${roundId} at ${snapshotTimestamp.toISOString()}`);

        // Step 1: Fetch CoinGecko data
        const coinGeckoData = await step.run("fetch-coingecko-data", async () => {
            const apiKey = process.env.COINGECKO_API_KEY;

            const response = await fetch(
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.statusText}`);
            }

            const data: CoinGeckoMarketData[] = await response.json();
            console.log(`   📊 Fetched ${data.length} coins from CoinGecko`);

            return data;
        });

        // Step 2: Filter and rank cryptos
        const { topGainers, worstPerformers } = await step.run("filter-and-rank", async () => {
            // Apply filters and ranking
            const filteredData = filterAndRankCryptos(coinGeckoData);
            console.log(`   ✅ Filtered to ${filteredData.length} coins`);

            // Sort by price change percentage (descending for top gainers)
            const sorted = [...filteredData].sort(
                (a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h
            );

            // Get top 5 gainers (highest percentage change)
            const topGainers = sorted.slice(0, 5);
            
            // Get worst 5 performers (lowest percentage change)
            const worstPerformers = sorted.slice(-5).reverse();

            console.log(`   🚀 Top gainer: ${topGainers[0]?.name} (${topGainers[0]?.price_change_percentage_24h}%)`);
            console.log(`   📉 Worst performer: ${worstPerformers[0]?.name} (${worstPerformers[0]?.price_change_percentage_24h}%)`);

            return { topGainers, worstPerformers };
        });

        // Step 3: Insert into database
        const insertedCount = await step.run("insert-to-database", async () => {
            const records = [];

            // Add top gainers
            for (let i = 0; i < topGainers.length; i++) {
                const coin = topGainers[i];
                records.push({
                    roundId,
                    coingeckoId: coin.id,
                    symbol: coin.symbol,
                    name: coin.name,
                    imageUrl: coin.image,
                    currentPrice: coin.current_price.toString(),
                    marketCap: coin.market_cap?.toString() || null,
                    marketCapRank: coin.market_cap_rank || null,
                    totalVolume: coin.total_volume?.toString() || null,
                    volumeRank: coin.volume_rank || null,
                    priceChangePercentage24h: coin.price_change_percentage_24h.toString(),
                    performanceCategory: "top_gainer" as const,
                    performanceRank: i, // 0-4
                    snapshotTimestamp,
                });
            }

            // Add worst performers
            for (let i = 0; i < worstPerformers.length; i++) {
                const coin = worstPerformers[i];
                records.push({
                    roundId,
                    coingeckoId: coin.id,
                    symbol: coin.symbol,
                    name: coin.name,
                    imageUrl: coin.image,
                    currentPrice: coin.current_price.toString(),
                    marketCap: coin.market_cap?.toString() || null,
                    marketCapRank: coin.market_cap_rank || null,
                    totalVolume: coin.total_volume?.toString() || null,
                    volumeRank: coin.volume_rank || null,
                    priceChangePercentage24h: coin.price_change_percentage_24h.toString(),
                    performanceCategory: "worst_performer" as const,
                    performanceRank: i, // 0-4
                    snapshotTimestamp,
                });
            }

            // Insert all records
            await db.insert(cryptoPerformanceLogs).values(records);

            console.log(`   💾 Inserted ${records.length} records to database`);
            
            return records.length;
        });

        console.log(`✅ [Crypto Snapshot] Round ${roundId} completed successfully`);

        return {
            success: true,
            roundId,
            snapshotTimestamp: snapshotTimestamp.toISOString(),
            recordsInserted: insertedCount,
            topGainer: topGainers[0]?.name,
            worstPerformer: worstPerformers[0]?.name,
        };
    }
);

