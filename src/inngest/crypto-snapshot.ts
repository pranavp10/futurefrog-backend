import { inngest } from "./client";
import { db } from "../db";
import { cryptoPerformanceLogs, cryptoMarketCache, userPredictionsSnapshots, userPointTransactions, type NewUserPredictionsSnapshot } from "../db/schema";
import {
    CoinGeckoMarketData,
    filterAndRankCryptos,
} from "../lib/crypto-filters";
import { randomUUID } from "crypto";
import { sql, eq, and, desc, lt } from "drizzle-orm";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { fetchAllUserPredictions } from "../lib/solana-predictions";
import { getBuyBackKeypair } from "../lib/buyback-utils";

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

        // Step 6: Score and reward eligible predictions
        const scoringResults = await step.run("score-and-reward-predictions", async () => {
            console.log(`\n   ========================================`);
            console.log(`   💰 Step 6: Scoring Eligible Predictions`);
            console.log(`   ========================================\n`);

            // Get PREDICTION_INTERVAL_MINUTES from env (default to 60 minutes if not set)
            const predictionIntervalMinutes = parseInt(process.env.PREDICTION_INTERVAL_MINUTES || '60');
            const intervalMs = predictionIntervalMinutes * 60 * 1000;
            const cutoffTime = new Date(Date.now() - intervalMs);

            console.log(`   ⏰ Prediction interval: ${predictionIntervalMinutes} minutes`);
            console.log(`   📅 Cutoff time: ${cutoffTime.toISOString()}`);

            // Find unprocessed predictions older than the interval
            console.log(`\n   🔍 Finding unprocessed predictions older than cutoff...`);
            const eligiblePredictions = await db
                .select()
                .from(userPredictionsSnapshots)
                .where(
                    and(
                        eq(userPredictionsSnapshots.processed, false),
                        lt(userPredictionsSnapshots.snapshotTimestamp, cutoffTime)
                    )
                );

            if (eligiblePredictions.length === 0) {
                console.log(`   ℹ️  No eligible predictions found to process`);
                return {
                    totalEligible: 0,
                    usersProcessed: 0,
                    totalPointsAwarded: 0,
                    predictionIds: [],
                };
            }

            console.log(`   ✅ Found ${eligiblePredictions.length} eligible predictions to process`);

            // Get latest round's performance data
            console.log(`\n   📊 Fetching latest round performance data...`);
            const latestRoundData = await db
                .select()
                .from(cryptoPerformanceLogs)
                .where(eq(cryptoPerformanceLogs.roundId, filterAndRank.roundId));

            if (latestRoundData.length === 0) {
                console.log(`   ⚠️  No performance data found for current round`);
                return {
                    totalEligible: eligiblePredictions.length,
                    usersProcessed: 0,
                    totalPointsAwarded: 0,
                    predictionIds: [],
                };
            }

            // Build lookup maps for quick scoring
            const topPerformers = latestRoundData
                .filter(r => r.performanceCategory === 'top_gainer')
                .sort((a, b) => a.performanceRank - b.performanceRank);
            
            const worstPerformers = latestRoundData
                .filter(r => r.performanceCategory === 'worst_performer')
                .sort((a, b) => a.performanceRank - b.performanceRank);

            // Create symbol-to-rank maps for both categories
            const topPerformerMap = new Map(topPerformers.map(p => [p.symbol.toLowerCase(), p.performanceRank]));
            const worstPerformerMap = new Map(worstPerformers.map(p => [p.symbol.toLowerCase(), p.performanceRank]));

            console.log(`   📈 Top performers: ${topPerformers.map(p => `${p.symbol}(#${p.performanceRank})`).join(', ')}`);
            console.log(`   📉 Worst performers: ${worstPerformers.map(p => `${p.symbol}(#${p.performanceRank})`).join(', ')}`);

            // Score each prediction and group by user
            console.log(`\n   🎯 Scoring predictions...`);
            const userScores = new Map<string, { totalPoints: number; predictions: typeof eligiblePredictions }>();

            for (const prediction of eligiblePredictions) {
                if (!prediction.symbol || prediction.symbol.trim() === '') {
                    continue; // Skip empty predictions
                }

                const symbol = prediction.symbol.toLowerCase();
                let pointsEarned = 0;

                // Determine which category map to use
                const relevantMap = prediction.predictionType === 'top_performer' ? topPerformerMap : worstPerformerMap;
                const actualRank = relevantMap.get(symbol);

                if (actualRank !== undefined) {
                    // Symbol was in the results!
                    if (actualRank === prediction.rank) {
                        // EXACT MATCH - Correct symbol AND correct rank
                        pointsEarned = 50;
                        console.log(`   🎯 EXACT MATCH: ${prediction.walletAddress.slice(0, 8)}... predicted ${symbol} at rank ${prediction.rank} in ${prediction.predictionType} (+${pointsEarned})`);
                    } else {
                        // CATEGORY MATCH - Correct symbol, wrong rank
                        pointsEarned = 10;
                        console.log(`   ✓ Category match: ${prediction.walletAddress.slice(0, 8)}... predicted ${symbol} (rank ${prediction.rank}, actual ${actualRank}) in ${prediction.predictionType} (+${pointsEarned})`);
                    }
                } else {
                    // No match - but we still give 1 point for participating
                    pointsEarned = 1;
                    console.log(`   • Participation: ${prediction.walletAddress.slice(0, 8)}... predicted ${symbol} in ${prediction.predictionType} (+${pointsEarned})`);
                }

                // Update the prediction record with earned points
                await db
                    .update(userPredictionsSnapshots)
                    .set({ pointsEarned })
                    .where(eq(userPredictionsSnapshots.id, prediction.id));

                // Accumulate points per user
                if (!userScores.has(prediction.walletAddress)) {
                    userScores.set(prediction.walletAddress, { totalPoints: 0, predictions: [] });
                }
                const userScore = userScores.get(prediction.walletAddress)!;
                userScore.totalPoints += pointsEarned;
                userScore.predictions.push(prediction);
            }

            console.log(`\n   💎 Calculating parlay bonuses...`);
            // Calculate parlay bonuses per user
            for (const [walletAddress, userScore] of userScores.entries()) {
                const predictions = userScore.predictions;
                
                // Group by prediction type
                const topPredictions = predictions.filter(p => p.predictionType === 'top_performer');
                const worstPredictions = predictions.filter(p => p.predictionType === 'worst_performer');

                let parlayBonus = 0;

                // Calculate bonuses for top_performer category
                const topCorrect = topPredictions.filter(p => {
                    const symbol = p.symbol?.toLowerCase();
                    return symbol && topPerformerMap.has(symbol);
                }).length;

                if (topCorrect >= 2) parlayBonus += 25;
                if (topCorrect >= 3) parlayBonus += 50; // Total +75
                if (topCorrect >= 4) parlayBonus += 125; // Total +200
                if (topCorrect === 5) parlayBonus += 300; // Total +500

                // Calculate bonuses for worst_performer category
                const worstCorrect = worstPredictions.filter(p => {
                    const symbol = p.symbol?.toLowerCase();
                    return symbol && worstPerformerMap.has(symbol);
                }).length;

                if (worstCorrect >= 2) parlayBonus += 25;
                if (worstCorrect >= 3) parlayBonus += 50;
                if (worstCorrect >= 4) parlayBonus += 125;
                if (worstCorrect === 5) parlayBonus += 300;

                // Cross-category bonus
                if (topCorrect > 0 && worstCorrect > 0) {
                    parlayBonus += 50;
                }

                userScore.totalPoints += parlayBonus;

                if (parlayBonus > 0) {
                    console.log(`   🎰 ${walletAddress.slice(0, 8)}... parlay bonus: +${parlayBonus} (top: ${topCorrect}/5, worst: ${worstCorrect}/5)`);
                }
            }

            // Update user points on Solana blockchain
            console.log(`\n   🔗 Updating user points on Solana...`);
            const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            const connection = new Connection(rpcUrl, 'confirmed');
            const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
            const UPDATE_USER_POINTS_IX = Buffer.from([0x40, 0x04, 0xb8, 0x7e, 0x00, 0x2e, 0xc4, 0x9f]);

            let usersProcessed = 0;
            let totalPointsAwarded = 0;
            const processedPredictionIds: string[] = [];

            try {
                const adminKeypair = await getBuyBackKeypair();
                console.log(`   🔑 Admin keypair loaded: ${adminKeypair.publicKey.toBase58()}`);

                for (const [walletAddress, userScore] of userScores.entries()) {
                    try {
                        const userPubkey = new PublicKey(walletAddress);
                        const pointsToAdd = userScore.totalPoints;

                        // Derive PDAs
                        const [globalStatePda] = PublicKey.findProgramAddressSync(
                            [Buffer.from('global_state')],
                            PROGRAM_ID
                        );

                        const [userPredictionsPda] = PublicKey.findProgramAddressSync(
                            [Buffer.from('user_predictions'), userPubkey.toBuffer()],
                            PROGRAM_ID
                        );

                        // Get current user account
                        const userAccount = await connection.getAccountInfo(userPredictionsPda);
                        if (!userAccount) {
                            console.log(`   ⚠️  User ${walletAddress.slice(0, 8)}... account not found, skipping`);
                            continue;
                        }

                        // Read current points and calculate new total
                        const currentPoints = userAccount.data.readBigUInt64LE(8 + 32 + 140);
                        const newPoints = Number(currentPoints) + pointsToAdd;

                        // Create instruction
                        const pointsBuffer = Buffer.alloc(8);
                        pointsBuffer.writeBigUInt64LE(BigInt(newPoints));
                        const instructionData = Buffer.concat([UPDATE_USER_POINTS_IX, pointsBuffer]);

                        const instruction = new TransactionInstruction({
                            programId: PROGRAM_ID,
                            keys: [
                                { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                                { pubkey: globalStatePda, isSigner: false, isWritable: false },
                                { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
                            ],
                            data: instructionData,
                        });

                        // Send transaction
                        const transaction = new Transaction().add(instruction);
                        const { blockhash } = await connection.getLatestBlockhash('confirmed');
                        transaction.recentBlockhash = blockhash;
                        transaction.feePayer = adminKeypair.publicKey;
                        transaction.sign(adminKeypair);

                        const signature = await connection.sendRawTransaction(transaction.serialize(), {
                            skipPreflight: false,
                            preflightCommitment: 'confirmed',
                        });

                        // Wait for confirmation
                        await connection.confirmTransaction(signature, 'confirmed');

                        console.log(`   ✅ ${walletAddress.slice(0, 8)}... +${pointsToAdd} points (${currentPoints} → ${newPoints}) | tx: ${signature.slice(0, 8)}...`);

                        // Record individual prediction reward transactions
                        for (const prediction of userScore.predictions) {
                            // Determine transaction type based on points earned
                            let transactionType = 'prediction_participation';
                            if (prediction.pointsEarned === 50) {
                                transactionType = 'prediction_exact_match';
                            } else if (prediction.pointsEarned === 10) {
                                transactionType = 'prediction_category_match';
                            }

                            await db.insert(userPointTransactions).values({
                                walletAddress,
                                roundId: filterAndRank.roundId,
                                transactionType,
                                pointsAmount: prediction.pointsEarned || 0,
                                solanaSignature: signature,
                                relatedPredictionIds: JSON.stringify([prediction.id]),
                                metadata: JSON.stringify({
                                    symbol: prediction.symbol,
                                    rank: prediction.rank,
                                    predictionType: prediction.predictionType,
                                }),
                            });

                            // Mark prediction as processed
                            await db
                                .update(userPredictionsSnapshots)
                                .set({ processed: true })
                                .where(eq(userPredictionsSnapshots.id, prediction.id));
                            processedPredictionIds.push(prediction.id);
                        }

                        // Record parlay bonus transactions if applicable
                        const predictions = userScore.predictions;
                        const topPredictions = predictions.filter(p => p.predictionType === 'top_performer');
                        const worstPredictions = predictions.filter(p => p.predictionType === 'worst_performer');

                        // Calculate individual bonus components for recording
                        const topCorrect = topPredictions.filter(p => {
                            const symbol = p.symbol?.toLowerCase();
                            return symbol && topPerformerMap.has(symbol);
                        }).length;

                        const worstCorrect = worstPredictions.filter(p => {
                            const symbol = p.symbol?.toLowerCase();
                            return symbol && worstPerformerMap.has(symbol);
                        }).length;

                        // Record top performer parlay bonus
                        if (topCorrect >= 2) {
                            let topBonus = 0;
                            if (topCorrect >= 2) topBonus += 25;
                            if (topCorrect >= 3) topBonus += 50;
                            if (topCorrect >= 4) topBonus += 125;
                            if (topCorrect === 5) topBonus += 300;

                            const topPredictionIds = topPredictions
                                .filter(p => {
                                    const symbol = p.symbol?.toLowerCase();
                                    return symbol && topPerformerMap.has(symbol);
                                })
                                .map(p => p.id);

                            await db.insert(userPointTransactions).values({
                                walletAddress,
                                roundId: filterAndRank.roundId,
                                transactionType: 'parlay_bonus_top',
                                pointsAmount: topBonus,
                                solanaSignature: signature,
                                relatedPredictionIds: JSON.stringify(topPredictionIds),
                                metadata: JSON.stringify({
                                    correctCount: topCorrect,
                                    totalSlots: 5,
                                }),
                            });
                        }

                        // Record worst performer parlay bonus
                        if (worstCorrect >= 2) {
                            let worstBonus = 0;
                            if (worstCorrect >= 2) worstBonus += 25;
                            if (worstCorrect >= 3) worstBonus += 50;
                            if (worstCorrect >= 4) worstBonus += 125;
                            if (worstCorrect === 5) worstBonus += 300;

                            const worstPredictionIds = worstPredictions
                                .filter(p => {
                                    const symbol = p.symbol?.toLowerCase();
                                    return symbol && worstPerformerMap.has(symbol);
                                })
                                .map(p => p.id);

                            await db.insert(userPointTransactions).values({
                                walletAddress,
                                roundId: filterAndRank.roundId,
                                transactionType: 'parlay_bonus_worst',
                                pointsAmount: worstBonus,
                                solanaSignature: signature,
                                relatedPredictionIds: JSON.stringify(worstPredictionIds),
                                metadata: JSON.stringify({
                                    correctCount: worstCorrect,
                                    totalSlots: 5,
                                }),
                            });
                        }

                        // Record cross-category bonus
                        if (topCorrect > 0 && worstCorrect > 0) {
                            const allCorrectPredictionIds = [
                                ...topPredictions.filter(p => {
                                    const symbol = p.symbol?.toLowerCase();
                                    return symbol && topPerformerMap.has(symbol);
                                }).map(p => p.id),
                                ...worstPredictions.filter(p => {
                                    const symbol = p.symbol?.toLowerCase();
                                    return symbol && worstPerformerMap.has(symbol);
                                }).map(p => p.id),
                            ];

                            await db.insert(userPointTransactions).values({
                                walletAddress,
                                roundId: filterAndRank.roundId,
                                transactionType: 'cross_category_bonus',
                                pointsAmount: 50,
                                solanaSignature: signature,
                                relatedPredictionIds: JSON.stringify(allCorrectPredictionIds),
                                metadata: JSON.stringify({
                                    topCorrect,
                                    worstCorrect,
                                }),
                            });
                        }

                        usersProcessed++;
                        totalPointsAwarded += pointsToAdd;

                    } catch (error: any) {
                        console.error(`   ❌ Error updating ${walletAddress.slice(0, 8)}...: ${error.message}`);
                    }
                }
            } catch (error: any) {
                console.error(`   ❌ Error loading admin keypair: ${error.message}`);
            }

            console.log(`\n   ========================================`);
            console.log(`   📊 Scoring Summary:`);
            console.log(`      Total eligible: ${eligiblePredictions.length}`);
            console.log(`      Users processed: ${usersProcessed}`);
            console.log(`      Total points awarded: ${totalPointsAwarded}`);
            console.log(`      Predictions marked processed: ${processedPredictionIds.length}`);
            console.log(`   ========================================\n`);

            return {
                totalEligible: eligiblePredictions.length,
                usersProcessed,
                totalPointsAwarded,
                predictionIds: processedPredictionIds,
            };
        });

        const duration = Date.now() - startTime;
        
        console.log(`\n========================================`);
        console.log(`✅ [Crypto Snapshot] Round ${filterAndRank.roundId} COMPLETED`);
        console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        console.log(`   Performance logs: ${insertedCount} records`);
        console.log(`   Cache records: ${cacheCount} records`);
        console.log(`   User predictions: ${userPredictionsCount.inserted} new/updated, ${userPredictionsCount.skipped} duplicates, ${userPredictionsCount.errors} errors, ${userPredictionsCount.totalProcessed} total`);
        console.log(`   Scoring: ${scoringResults.usersProcessed} users, ${scoringResults.totalPointsAwarded} points awarded`);
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
            scoring: {
                totalEligible: scoringResults.totalEligible,
                usersProcessed: scoringResults.usersProcessed,
                totalPointsAwarded: scoringResults.totalPointsAwarded,
                predictionsProcessed: scoringResults.predictionIds.length,
            },
            topGainer: filterAndRank.topGainers[0]?.name,
            worstPerformer: filterAndRank.worstPerformers[0]?.name,
        };
    }
);



