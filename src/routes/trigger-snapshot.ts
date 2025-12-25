import { Elysia } from 'elysia';
import { db } from '../db';
import { cryptoPerformanceLogs, cryptoMarketCache, coinMetadata } from '../db/schema';
import {
    CoinGeckoMarketData,
    filterAndRankCryptos,
} from '../lib/crypto-filters';
import { randomUUID } from 'crypto';
import { sql, eq, or } from 'drizzle-orm';

/**
 * Manual trigger route for crypto snapshot
 * This allows testing the snapshot functionality without Inngest
 */
export const triggerSnapshotRoute = new Elysia({ prefix: '/api' })
    .post('/trigger-snapshot', async ({ set }) => {
        try {
            const snapshotTimestamp = new Date();
            const roundId = randomUUID();

            console.log(`🐸 [Manual Snapshot] Starting round ${roundId} at ${snapshotTimestamp.toISOString()}`);

            // Step 1: Fetch CoinGecko data
            const apiKey = process.env.COINGECKO_API_KEY;
            const response = await fetch(
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.statusText}`);
            }

            const data: CoinGeckoMarketData[] = await response.json();
            console.log(`   📊 Fetched ${data.length} coins from CoinGecko`);

            // Step 2: Filter and rank cryptos
            const filteredData = filterAndRankCryptos(data);
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

            // Step 3: Populate cache table (insert first, then cleanup old data) + update coin metadata
            const cacheRecords = filteredData.map(coin => ({
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
                snapshotTimestamp,
            }));

            // Insert new records FIRST (ensures cache is never empty)
            await db.insert(cryptoMarketCache).values(cacheRecords);
            console.log(`   💾 Inserted ${cacheRecords.length} new records into crypto_market_cache (roundId: ${roundId})`);

            // Delete old records from previous rounds (keep only current round)
            await db
                .delete(cryptoMarketCache)
                .where(sql`${cryptoMarketCache.roundId} != ${roundId}`);
            
            console.log(`   🗑️  Cleaned up old records from previous rounds`);

            // Update coin metadata table with new coins
            console.log(`   🪙 Checking coin metadata...`);
            let newCoinsAdded = 0;
            let coinsUpdated = 0;
            
            for (const coin of filteredData) {
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

            // Step 4: Insert top 5 and worst 5 into performance logs
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
                    performanceRank: i + 1, // 1-5
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
                    performanceRank: i + 1, // 1-5
                    snapshotTimestamp,
                });
            }

            // Insert performance records (top 5 + worst 5)
            await db.insert(cryptoPerformanceLogs).values(records);

            console.log(`   💾 Inserted ${records.length} records into crypto_performance_logs`);
            console.log(`✅ [Manual Snapshot] Round ${roundId} completed successfully`);

            return {
                success: true,
                roundId,
                snapshotTimestamp: snapshotTimestamp.toISOString(),
                performanceLogsInserted: records.length,
                cacheRecordsInserted: cacheRecords.length,
                topGainer: {
                    name: topGainers[0]?.name,
                    symbol: topGainers[0]?.symbol,
                    change: topGainers[0]?.price_change_percentage_24h,
                },
                worstPerformer: {
                    name: worstPerformers[0]?.name,
                    symbol: worstPerformers[0]?.symbol,
                    change: worstPerformers[0]?.price_change_percentage_24h,
                },
                topGainers: topGainers.map(c => ({
                    name: c.name,
                    symbol: c.symbol,
                    change: c.price_change_percentage_24h,
                })),
                worstPerformers: worstPerformers.map(c => ({
                    name: c.name,
                    symbol: c.symbol,
                    change: c.price_change_percentage_24h,
                })),
            };
        } catch (error) {
            console.error('Error in manual snapshot:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run snapshot',
            };
        }
    });

