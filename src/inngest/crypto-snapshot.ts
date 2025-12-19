import { inngest } from "./client";
import { db } from "../db";
import { cryptoPerformanceLogs, cryptoMarketCache, userPredictionsSnapshots, type NewUserPredictionsSnapshot } from "../db/schema";
import {
    CoinGeckoMarketData,
    filterAndRankCryptos,
} from "../lib/crypto-filters";
import { randomUUID } from "crypto";
import { sql, eq, and, desc } from "drizzle-orm";
import { Connection } from "@solana/web3.js";
import { fetchAllUserPredictions } from "../lib/solana-predictions";

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

        // Step 3: Purge and populate cache table
        const cacheCount = await step.run("populate-cache", async () => {
            await db.execute(sql`TRUNCATE TABLE crypto_market_cache`);
            console.log(`   🗑️  Purged crypto_market_cache table`);

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

            await db.insert(cryptoMarketCache).values(cacheRecords);
            console.log(`   💾 Inserted ${cacheRecords.length} records into crypto_market_cache`);

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

        // Step 5: Fetch and store user predictions from blockchain
        const userPredictionsCount = await step.run("fetch-user-predictions", async () => {
            const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            const connection = new Connection(rpcUrl, 'confirmed');

            console.log(`\n   🔗 Connecting to Solana RPC: ${rpcUrl}`);

            // Fetch all user predictions from blockchain
            console.log(`   📡 Fetching user predictions from blockchain...`);
            const allUserPredictions = await fetchAllUserPredictions(connection);

            if (allUserPredictions.length === 0) {
                console.log(`   ℹ️  No user predictions found on blockchain`);
                return { inserted: 0, skipped: 0, totalProcessed: 0, errors: 0 };
            }

            console.log(`   📋 Processing predictions for ${allUserPredictions.length} users...\n`);

            let insertedCount = 0;
            let skippedCount = 0;
            let totalPredictions = 0;
            let errorCount = 0;

            // Process each user's predictions
            for (const { userAddress, predictions } of allUserPredictions) {
                console.log(`\n   👤 Processing user: ${userAddress.slice(0, 8)}...${userAddress.slice(-4)}`);
                console.log(`      Points: ${predictions.points} | Last updated: ${predictions.lastUpdated}`);
                
                const predictionRecords: NewUserPredictionsSnapshot[] = [];

                // Process top performer predictions (ranks 1-5)
                for (let rank = 1; rank <= 5; rank++) {
                    const symbol = predictions.topPerformer[rank - 1];
                    const predictionTimestamp = predictions.topPerformerTimestamps[rank - 1];

                    console.log(`      🔍 Top performer rank ${rank}: symbol="${symbol}" | timestamp=${predictionTimestamp}`);

                    // Only create record if there's actually a prediction (symbol exists)
                    if (symbol && symbol.trim() !== '') {
                        predictionRecords.push({
                            walletAddress: userAddress,
                            predictionType: 'top_performer',
                            rank,
                            symbol: symbol.trim(),
                            predictionTimestamp: predictionTimestamp || null,
                            points: predictions.points,
                            lastUpdated: predictions.lastUpdated || null,
                            snapshotTimestamp,
                        });
                    }
                }

                // Process worst performer predictions (ranks 1-5)
                for (let rank = 1; rank <= 5; rank++) {
                    const symbol = predictions.worstPerformer[rank - 1];
                    const predictionTimestamp = predictions.worstPerformerTimestamps[rank - 1];

                    console.log(`      🔍 Worst performer rank ${rank}: symbol="${symbol}" | timestamp=${predictionTimestamp}`);

                    // Only create record if there's actually a prediction (symbol exists)
                    if (symbol && symbol.trim() !== '') {
                        predictionRecords.push({
                            walletAddress: userAddress,
                            predictionType: 'worst_performer',
                            rank,
                            symbol: symbol.trim(),
                            predictionTimestamp: predictionTimestamp || null,
                            points: predictions.points,
                            lastUpdated: predictions.lastUpdated || null,
                            snapshotTimestamp,
                        });
                    }
                }

                totalPredictions += predictionRecords.length;
                console.log(`      📝 Found ${predictionRecords.length} predictions to process`);

                // Check each prediction to see if it's new or updated
                for (const record of predictionRecords) {
                    try {
                        // Query for the most recent prediction for this user/type/rank
                        console.log(`         🔎 Checking existing records for ${record.predictionType} rank ${record.rank}...`);
                        
                        const existingPredictions = await db
                            .select()
                            .from(userPredictionsSnapshots)
                            .where(
                                and(
                                    eq(userPredictionsSnapshots.walletAddress, record.walletAddress),
                                    eq(userPredictionsSnapshots.predictionType, record.predictionType),
                                    eq(userPredictionsSnapshots.rank, record.rank)
                                )
                            )
                            .orderBy(desc(userPredictionsSnapshots.predictionTimestamp))
                            .limit(1);

                        // Determine if we should insert
                        let shouldInsert = false;
                        let reason = '';

                        if (existingPredictions.length === 0) {
                            // No existing record - this is a brand new prediction
                            shouldInsert = true;
                            reason = 'NEW PREDICTION';
                            console.log(`         ✨ New prediction detected!`);
                        } else {
                            const existing = existingPredictions[0];
                            console.log(`         📊 Found existing: symbol="${existing.symbol}" | timestamp=${existing.predictionTimestamp}`);
                            
                            // Check if the timestamp has changed (prediction was updated)
                            if (existing.predictionTimestamp !== record.predictionTimestamp) {
                                shouldInsert = true;
                                reason = `UPDATED (ts: ${existing.predictionTimestamp} → ${record.predictionTimestamp})`;
                                console.log(`         🔄 Timestamp changed - prediction was updated!`);
                            } else if (existing.symbol !== record.symbol) {
                                // This shouldn't happen if timestamps are working correctly, but check symbol too
                                shouldInsert = true;
                                reason = `SYMBOL CHANGED (${existing.symbol} → ${record.symbol})`;
                                console.log(`         ⚠️  Symbol changed without timestamp change!`);
                            } else {
                                // Same prediction already exists
                                reason = 'DUPLICATE (no changes)';
                                console.log(`         ⏭️  Already recorded - skipping`);
                            }
                        }

                        if (shouldInsert) {
                            await db.insert(userPredictionsSnapshots).values(record);
                            insertedCount++;
                            console.log(`         ✅ INSERTED: ${record.predictionType} | rank ${record.rank} | ${record.symbol} | ts: ${record.predictionTimestamp} | Reason: ${reason}`);
                        } else {
                            skippedCount++;
                            console.log(`         ⏭️  SKIPPED: ${record.predictionType} | rank ${record.rank} | ${record.symbol} | Reason: ${reason}`);
                        }
                    } catch (error: any) {
                        errorCount++;
                        console.error(`         ❌ ERROR processing prediction:`, {
                            wallet: record.walletAddress.slice(0, 8),
                            type: record.predictionType,
                            rank: record.rank,
                            symbol: record.symbol,
                            error: error.message,
                            code: error.code
                        });
                    }
                }
            }

            console.log(`\n   ========================================`);
            console.log(`   📊 User Predictions Summary:`);
            console.log(`      Total users processed: ${allUserPredictions.length}`);
            console.log(`      Total predictions found: ${totalPredictions}`);
            console.log(`      ✅ New/Updated inserted: ${insertedCount}`);
            console.log(`      ⏭️  Duplicates skipped: ${skippedCount}`);
            console.log(`      ❌ Errors: ${errorCount}`);
            console.log(`   ========================================\n`);

            return { 
                inserted: insertedCount, 
                skipped: skippedCount, 
                totalProcessed: totalPredictions,
                errors: errorCount
            };
        });

        const duration = Date.now() - startTime;
        
        console.log(`\n========================================`);
        console.log(`✅ [Crypto Snapshot] Round ${filterAndRank.roundId} COMPLETED`);
        console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        console.log(`   Performance logs: ${insertedCount} records`);
        console.log(`   Cache records: ${cacheCount} records`);
        console.log(`   User predictions: ${userPredictionsCount.inserted} new/updated, ${userPredictionsCount.skipped} duplicates, ${userPredictionsCount.errors} errors, ${userPredictionsCount.totalProcessed} total`);
        console.log(`   Top gainer: ${filterAndRank.topGainers[0]?.name}`);
        console.log(`   Worst performer: ${filterAndRank.worstPerformers[0]?.name}`);
        console.log(`========================================\n`);

        return {
            success: true,
            roundId: filterAndRank.roundId,
            snapshotTimestamp: snapshotTimestamp.toISOString(),
            performanceLogsInserted: insertedCount,
            cacheRecordsInserted: cacheCount,
            userPredictions: {
                inserted: userPredictionsCount.inserted,
                skipped: userPredictionsCount.skipped,
                errors: userPredictionsCount.errors,
                totalProcessed: userPredictionsCount.totalProcessed,
            },
            topGainer: filterAndRank.topGainers[0]?.name,
            worstPerformer: filterAndRank.worstPerformers[0]?.name,
        };
    }
);



