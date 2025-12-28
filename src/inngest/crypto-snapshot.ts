import { inngest } from "./client";
import { db } from "../db";
import { cryptoPerformanceLogs, cryptoMarketCache, coinMetadata } from "../db/schema";
import {
    CoinGeckoMarketData,
    filterAndRankCryptos,
} from "../lib/crypto-filters";
import { randomUUID } from "crypto";
import { sql, eq, or } from "drizzle-orm";

/**
 * Scheduled job to capture crypto performance snapshots
 * Runs every X minutes as configured by CRYPTO_SNAPSHOT_FREQUENCY_MINUTES
 * Only runs if CRYPTO_SNAPSHOT_ON is set to "true"
 */
export const cryptoSnapshot = inngest.createFunction(
    { id: "crypto-snapshot" },
    // Only set up cron schedule if CRYPTO_SNAPSHOT_ON is true
    process.env.CRYPTO_SNAPSHOT_ON === "true"
        ? {
            cron: process.env.CRYPTO_SNAPSHOT_FREQUENCY_MINUTES
                ? `*/${process.env.CRYPTO_SNAPSHOT_FREQUENCY_MINUTES} * * * *`
                : "*/15 * * * *",
        }
        : { event: "crypto/snapshot.manual" }, // Only triggered manually if disabled
    async ({ event, step }) => {
        const startTime = Date.now();
        const snapshotTimestamp = new Date();

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

        // Step 2: Filter and rank cryptos (generate roundId here to ensure consistency)
        const filterAndRank = await step.run("filter-and-rank", async () => {
            const roundId = randomUUID();
            
            console.log(`\n========================================`);
            console.log(`🐸 [Crypto Snapshot] Starting Round ${roundId}`);
            console.log(`   Trigger type: ${event.name || 'cron'}`);
            console.log(`   Time: ${snapshotTimestamp.toISOString()}`);
            console.log(`========================================\n`);

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

            return { roundId, topGainers, worstPerformers, filteredData };
        });

        // Step 3: Populate cache table (insert first, then cleanup old data) + update coin metadata
        const cacheCount = await step.run("populate-cache", async () => {
            const cacheRecords = filterAndRank.filteredData.map(coin => ({
                roundId: filterAndRank.roundId,
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
                snapshotTimestamp,
            }));

            // Insert new records FIRST (ensures cache is never empty)
            await db.insert(cryptoMarketCache).values(cacheRecords);
            console.log(`   💾 Inserted ${cacheRecords.length} new records into crypto_market_cache (roundId: ${filterAndRank.roundId})`);

            // Delete old records from previous rounds (keep only current round)
            const deleteResult = await db
                .delete(cryptoMarketCache)
                .where(sql`${cryptoMarketCache.roundId} != ${filterAndRank.roundId}`);
            
            console.log(`   🗑️  Cleaned up old records from previous rounds`);

            // Update coin metadata table with new coins
            console.log(`   🪙 Checking coin metadata...`);
            let newCoinsAdded = 0;
            let coinsUpdated = 0;
            
            for (const coin of filterAndRank.filteredData) {
                try {
                    // Check if coin exists in metadata table
                    const existingCoin = await db
                        .select()
                        .from(coinMetadata)
                        .where(
                            or(
                                eq(coinMetadata.coingeckoId, coin.id),
                                eq(coinMetadata.symbol, coin.symbol)
                            )
                        )
                        .limit(1);

                    if (existingCoin.length === 0) {
                        // Coin doesn't exist, insert it
                        await db.insert(coinMetadata).values({
                            coingeckoId: coin.id,
                            symbol: coin.symbol,
                            name: coin.name,
                            imageUrl: coin.image,
                        });
                        newCoinsAdded++;
                    } else {
                        // Coin exists, update metadata if it changed
                        const existing = existingCoin[0];
                        if (existing.name !== coin.name || existing.imageUrl !== coin.image) {
                            await db
                                .update(coinMetadata)
                                .set({
                                    name: coin.name,
                                    imageUrl: coin.image,
                                    updatedAt: new Date(),
                                })
                                .where(eq(coinMetadata.coingeckoId, coin.id));
                            coinsUpdated++;
                        }
                    }
                } catch (error: any) {
                    console.error(`   ⚠️  Error processing metadata for ${coin.symbol}: ${error.message}`);
                }
            }

            console.log(`   ✨ Coin metadata: ${newCoinsAdded} new, ${coinsUpdated} updated`);

            return cacheRecords.length;
        });

        // Step 4: Insert top 5 and worst 5 into performance logs
        const insertedCount = await step.run("insert-performance-logs", async () => {
            const records = [];

            // Add top gainers
            for (let i = 0; i < filterAndRank.topGainers.length; i++) {
                const coin = filterAndRank.topGainers[i];
                records.push({
                    roundId: filterAndRank.roundId,
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
                    performanceRank: i + 1, // 1-5
                    snapshotTimestamp,
                });
            }

            // Add worst performers
            for (let i = 0; i < filterAndRank.worstPerformers.length; i++) {
                const coin = filterAndRank.worstPerformers[i];
                records.push({
                    roundId: filterAndRank.roundId,
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
                    performanceRank: i + 1, // 1-5
                    snapshotTimestamp,
                });
            }

            // Insert performance records
            await db.insert(cryptoPerformanceLogs).values(records);

            console.log(`   💾 Inserted ${records.length} records into crypto_performance_logs`);
            
            return records.length;
        });

        const duration = Date.now() - startTime;
        
        console.log(`\n========================================`);
        console.log(`✅ [Crypto Snapshot] Round ${filterAndRank.roundId} COMPLETED`);
        console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        console.log(`   Performance logs: ${insertedCount} records`);
        console.log(`   Cache records: ${cacheCount} records`);
        console.log(`   Top gainer: ${filterAndRank.topGainers[0]?.name}`);
        console.log(`   Worst performer: ${filterAndRank.worstPerformers[0]?.name}`);
        console.log(`========================================\n`);

        return {
            success: true,
            roundId: filterAndRank.roundId,
            snapshotTimestamp: snapshotTimestamp.toISOString(),
            performanceLogsInserted: insertedCount,
            cacheRecordsInserted: cacheCount,
            topGainer: filterAndRank.topGainers[0]?.name,
            worstPerformer: filterAndRank.worstPerformers[0]?.name,
        };
    }
);



