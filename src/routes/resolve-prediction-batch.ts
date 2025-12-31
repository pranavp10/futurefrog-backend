import { Elysia } from 'elysia';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getBuyBackKeypair } from '../lib/buyback-utils';
import { fetchHistoricalPriceForResolution } from '../lib/historical-price';
import { db } from '../db';
import { userPredictionsSnapshots } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getRedisClient } from '../lib/redis';
import { getAIPublicKey, type AIKeypairName, AI_KEYPAIR_NAMES } from '../lib/ai-keypairs-utils';

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'GGw3GTVpjwLhHdsK4dY3Kb1Lb3vpz5Ns6zV3aMWcf9xe');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PRICE_MULTIPLIER = 1_000_000_000; // 9 decimals

// Instruction discriminators
const ADMIN_SET_RESOLUTION_PRICE_IX = Buffer.from([0xcb, 0x7e, 0x48, 0x89, 0xa4, 0xfc, 0xb3, 0x89]);
const UPDATE_USER_POINTS_IX = Buffer.from([0x40, 0x04, 0xb8, 0x7e, 0x00, 0x2e, 0xc4, 0x9f]);
const ADMIN_CLEAR_USER_SILOS_IX = Buffer.from([0x72, 0xee, 0x6d, 0xd7, 0xf7, 0xac, 0x3c, 0xe9]);

// Lock timeout
const RESOLUTION_LOCK_TIMEOUT = 120; // 2 minutes for batch operations

interface PredictionToResolve {
    predictionType: 'top_performer' | 'worst_performer';
    siloIndex: number;
    coinId: string;
    predictionTimestamp: number;
    duration: number;
    predictedPercentage: number;
    priceAtPrediction: number;
}

interface BatchResolutionResult {
    success: boolean;
    message: string;
    data?: {
        totalPredictions: number;
        totalPointsAwarded: number;
        newTotalPoints: number;
        signature: string;
        resolutions: Array<{
            coinId: string;
            predictionType: string;
            siloIndex: number;
            pointsAwarded: number;
            accuracyLabel: string;
        }>;
    };
    error?: string;
}

/**
 * Calculate points based on accuracy
 */
function calculateAccuracyPoints(
    predictedPercentage: number,
    actualPercentage: number,
    predictionType: 'top_performer' | 'worst_performer'
): { points: number; label: string } {
    const expectedDirection = predictionType === 'top_performer' ? 'up' : 'down';
    const actualDirection = actualPercentage >= 0 ? 'up' : 'down';

    if (expectedDirection !== actualDirection) {
        return { points: 10, label: 'wrong_direction' };
    }

    const predictedAbs = Math.abs(predictedPercentage);
    const actualAbs = Math.abs(actualPercentage);
    const error = Math.abs(predictedAbs - actualAbs);

    if (error <= 1) return { points: 1000, label: 'perfect' };
    if (error <= 2) return { points: 750, label: 'excellent' };
    if (error <= 5) return { points: 500, label: 'great' };
    if (error <= 10) return { points: 250, label: 'good' };
    if (error <= 20) return { points: 100, label: 'fair' };
    return { points: 50, label: 'correct_direction' };
}

/**
 * Parse user predictions account data
 */
function parseUserPredictionsAccount(data: Buffer): {
    topPerformer: string[];
    worstPerformer: string[];
    topPerformerTimestamps: number[];
    worstPerformerTimestamps: number[];
    topPerformerPercentages: number[];
    worstPerformerPercentages: number[];
    topPerformerPrices: bigint[];
    worstPerformerPrices: bigint[];
    topPerformerDurations: number[];
    worstPerformerDurations: number[];
    predictionCount: number;
    points: number;
} {
    const parseFixedString = (bytes: Uint8Array): string => {
        return new TextDecoder().decode(bytes).trimEnd();
    };

    let offset = 40; // Skip discriminator (8) + owner (32)

    // Read arrays
    const topPerformer: string[] = [];
    for (let i = 0; i < 5; i++) {
        topPerformer.push(parseFixedString(data.slice(offset, offset + 32)));
        offset += 32;
    }

    const worstPerformer: string[] = [];
    for (let i = 0; i < 5; i++) {
        worstPerformer.push(parseFixedString(data.slice(offset, offset + 32)));
        offset += 32;
    }

    const topPerformerTimestamps: number[] = [];
    for (let i = 0; i < 5; i++) {
        topPerformerTimestamps.push(Number(data.readBigInt64LE(offset)));
        offset += 8;
    }

    const worstPerformerTimestamps: number[] = [];
    for (let i = 0; i < 5; i++) {
        worstPerformerTimestamps.push(Number(data.readBigInt64LE(offset)));
        offset += 8;
    }

    const topPerformerPercentages: number[] = [];
    for (let i = 0; i < 5; i++) {
        topPerformerPercentages.push(data.readInt16LE(offset));
        offset += 2;
    }

    const worstPerformerPercentages: number[] = [];
    for (let i = 0; i < 5; i++) {
        worstPerformerPercentages.push(data.readInt16LE(offset));
        offset += 2;
    }

    const topPerformerPrices: bigint[] = [];
    for (let i = 0; i < 5; i++) {
        topPerformerPrices.push(data.readBigUInt64LE(offset));
        offset += 8;
    }

    const worstPerformerPrices: bigint[] = [];
    for (let i = 0; i < 5; i++) {
        worstPerformerPrices.push(data.readBigUInt64LE(offset));
        offset += 8;
    }

    // Skip resolution prices
    offset += 8 * 5 * 2;

    const topPerformerDurations: number[] = [];
    for (let i = 0; i < 5; i++) {
        topPerformerDurations.push(Number(data.readBigInt64LE(offset)));
        offset += 8;
    }

    const worstPerformerDurations: number[] = [];
    for (let i = 0; i < 5; i++) {
        worstPerformerDurations.push(Number(data.readBigInt64LE(offset)));
        offset += 8;
    }

    const predictionCount = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const points = Number(data.readBigUInt64LE(offset));

    return {
        topPerformer,
        worstPerformer,
        topPerformerTimestamps,
        worstPerformerTimestamps,
        topPerformerPercentages,
        worstPerformerPercentages,
        topPerformerPrices,
        worstPerformerPrices,
        topPerformerDurations,
        worstPerformerDurations,
        predictionCount,
        points,
    };
}

async function acquireResolutionLock(walletAddress: string): Promise<boolean> {
    const redis = getRedisClient();
    const lockKey = `resolution_lock:${walletAddress}`;
    const result = await redis.set(lockKey, Date.now().toString(), 'EX', RESOLUTION_LOCK_TIMEOUT, 'NX');
    return result === 'OK';
}

async function releaseResolutionLock(walletAddress: string): Promise<void> {
    const redis = getRedisClient();
    const lockKey = `resolution_lock:${walletAddress}`;
    await redis.del(lockKey);
}

export const resolvePredictionBatchRoutes = new Elysia()
    // Batch resolve predictions for a specific wallet/agent (up to 10 at once)
    .post('/resolve-prediction/batch', async ({ body }): Promise<BatchResolutionResult> => {
        const { walletAddress, agentName } = body as { 
            walletAddress?: string; 
            agentName?: string;
        };

        // Get wallet address from agentName if provided
        let targetWallet = walletAddress;
        if (agentName && !targetWallet) {
            if (!AI_KEYPAIR_NAMES.includes(agentName as AIKeypairName)) {
                return {
                    success: false,
                    message: 'Invalid agent name',
                    error: 'INVALID_AGENT',
                };
            }
            targetWallet = await getAIPublicKey(agentName as AIKeypairName);
        }

        if (!targetWallet) {
            return {
                success: false,
                message: 'Wallet address or agent name required',
                error: 'MISSING_WALLET',
            };
        }

        console.log(`\n========================================`);
        console.log(`🚀 Batch Resolving Predictions`);
        console.log(`   Wallet: ${targetWallet}`);
        if (agentName) console.log(`   Agent: ${agentName}`);
        console.log(`========================================\n`);

        // Acquire lock
        const lockAcquired = await acquireResolutionLock(targetWallet);
        if (!lockAcquired) {
            return {
                success: false,
                message: 'Another resolution is in progress. Please wait.',
                error: 'RESOLUTION_IN_PROGRESS',
            };
        }

        try {
            const connection = new Connection(RPC_URL, 'confirmed');
            const userPubkey = new PublicKey(targetWallet);

            // Get user predictions PDA
            const [userPredictionsPda] = PublicKey.findProgramAddressSync(
                [Buffer.from('user_predictions'), userPubkey.toBuffer()],
                PROGRAM_ID
            );

            // Fetch account data
            const accountInfo = await connection.getAccountInfo(userPredictionsPda);
            if (!accountInfo) {
                await releaseResolutionLock(targetWallet);
                return {
                    success: false,
                    message: 'User predictions account not found',
                    error: 'ACCOUNT_NOT_FOUND',
                };
            }

            const predictions = parseUserPredictionsAccount(accountInfo.data as Buffer);
            const now = Math.floor(Date.now() / 1000);

            // Find all predictions ready to resolve
            const toResolve: PredictionToResolve[] = [];

            // Check top performers
            for (let i = 0; i < 5; i++) {
                const coinId = predictions.topPerformer[i];
                const timestamp = predictions.topPerformerTimestamps[i];
                const duration = predictions.topPerformerDurations[i];
                
                if (coinId && coinId.trim() !== '' && timestamp > 0 && duration > 0) {
                    const resolutionTime = timestamp + duration;
                    if (now >= resolutionTime) {
                        toResolve.push({
                            predictionType: 'top_performer',
                            siloIndex: i,
                            coinId,
                            predictionTimestamp: timestamp,
                            duration,
                            predictedPercentage: predictions.topPerformerPercentages[i],
                            priceAtPrediction: Number(predictions.topPerformerPrices[i]) / PRICE_MULTIPLIER,
                        });
                    }
                }
            }

            // Check worst performers
            for (let i = 0; i < 5; i++) {
                const coinId = predictions.worstPerformer[i];
                const timestamp = predictions.worstPerformerTimestamps[i];
                const duration = predictions.worstPerformerDurations[i];
                
                if (coinId && coinId.trim() !== '' && timestamp > 0 && duration > 0) {
                    const resolutionTime = timestamp + duration;
                    if (now >= resolutionTime) {
                        toResolve.push({
                            predictionType: 'worst_performer',
                            siloIndex: i,
                            coinId,
                            predictionTimestamp: timestamp,
                            duration,
                            predictedPercentage: predictions.worstPerformerPercentages[i],
                            priceAtPrediction: Number(predictions.worstPerformerPrices[i]) / PRICE_MULTIPLIER,
                        });
                    }
                }
            }

            if (toResolve.length === 0) {
                await releaseResolutionLock(targetWallet);
                return {
                    success: false,
                    message: 'No predictions ready to resolve',
                    error: 'NO_READY_PREDICTIONS',
                };
            }

            // Limit to 10 predictions per transaction
            const batch = toResolve.slice(0, 10);
            console.log(`📊 Found ${toResolve.length} predictions ready, resolving ${batch.length} in this batch\n`);

            // Fetch all prices and calculate points
            const resolutions: Array<{
                prediction: PredictionToResolve;
                priceAtResolution: number;
                actualPercentage: number;
                pointsAwarded: number;
                accuracyLabel: string;
            }> = [];

            let totalPointsAwarded = 0;

            for (const pred of batch) {
                const resolutionTimestamp = pred.predictionTimestamp + pred.duration;
                
                console.log(`\n📡 Processing ${pred.coinId} (${pred.predictionType})...`);
                console.log(`   Prediction time: ${new Date(pred.predictionTimestamp * 1000).toISOString()}`);
                console.log(`   Resolution time: ${new Date(resolutionTimestamp * 1000).toISOString()}`);
                console.log(`   Duration: ${pred.duration}s (${Math.floor(pred.duration / 3600)}h)`);
                
                const priceAtResolution = await fetchHistoricalPriceForResolution(
                    pred.coinId,
                    resolutionTimestamp
                );

                if (priceAtResolution === null) {
                    console.warn(`⚠️ Could not fetch price for ${pred.coinId}, skipping`);
                    continue;
                }

                const actualPercentage = ((priceAtResolution - pred.priceAtPrediction) / pred.priceAtPrediction) * 100;
                const { points, label } = calculateAccuracyPoints(
                    pred.predictedPercentage,
                    actualPercentage,
                    pred.predictionType
                );

                totalPointsAwarded += points;

                resolutions.push({
                    prediction: pred,
                    priceAtResolution,
                    actualPercentage,
                    pointsAwarded: points,
                    accuracyLabel: label,
                });

                console.log(`   💰 Price at entry: $${pred.priceAtPrediction.toFixed(8)}`);
                console.log(`   💰 Price at exit: $${priceAtResolution.toFixed(8)}`);
                console.log(`   📊 Predicted: ${pred.predictedPercentage.toFixed(2)}%`);
                console.log(`   📊 Actual: ${actualPercentage.toFixed(2)}%`);
                console.log(`   🎯 Result: ${label} (+${points} pts)`);
            }

            if (resolutions.length === 0) {
                await releaseResolutionLock(targetWallet);
                return {
                    success: false,
                    message: 'Could not fetch prices for any predictions',
                    error: 'PRICE_FETCH_FAILED',
                };
            }

            // Build batched transaction
            const adminKeypair = await getBuyBackKeypair();
            const [globalStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from('global_state')],
                PROGRAM_ID
            );

            const transaction = new Transaction();

            // Add set resolution price instructions for each prediction
            for (const res of resolutions) {
                const vaultTypeByte = res.prediction.predictionType === 'top_performer' ? 0 : 1;
                const resolutionPriceU64 = BigInt(Math.floor(res.priceAtResolution * PRICE_MULTIPLIER));
                const priceBuffer = Buffer.alloc(8);
                priceBuffer.writeBigUInt64LE(resolutionPriceU64);

                transaction.add(new TransactionInstruction({
                    programId: PROGRAM_ID,
                    keys: [
                        { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                        { pubkey: globalStatePda, isSigner: false, isWritable: false },
                        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
                    ],
                    data: Buffer.concat([
                        ADMIN_SET_RESOLUTION_PRICE_IX,
                        Buffer.from([vaultTypeByte]),
                        Buffer.from([res.prediction.siloIndex]),
                        priceBuffer,
                    ]),
                }));
            }

            // Add update points instruction (once with total)
            const newTotalPoints = predictions.points + totalPointsAwarded;
            const pointsBuffer = Buffer.alloc(8);
            pointsBuffer.writeBigUInt64LE(BigInt(newTotalPoints));

            transaction.add(new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [
                    { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                    { pubkey: globalStatePda, isSigner: false, isWritable: false },
                    { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
                ],
                data: Buffer.concat([UPDATE_USER_POINTS_IX, pointsBuffer]),
            }));

            // Add clear all silos instruction (clears everything at once)
            transaction.add(new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [
                    { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                    { pubkey: globalStatePda, isSigner: false, isWritable: false },
                    { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
                ],
                data: ADMIN_CLEAR_USER_SILOS_IX,
            }));

            // Send transaction
            console.log(`\n📤 Sending batched transaction with ${resolutions.length + 2} instructions...`);
            const { blockhash } = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = adminKeypair.publicKey;
            transaction.sign(adminKeypair);

            const signature = await connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
            });

            await connection.confirmTransaction(signature, 'confirmed');

            console.log(`\n✅ Transaction confirmed: ${signature}`);
            console.log(`   📝 Set resolution prices for ${resolutions.length} predictions`);
            console.log(`   🎯 Points updated: ${predictions.points} → ${newTotalPoints} (+${totalPointsAwarded})`);
            console.log(`   🧹 Cleared all silos`);

            // Record all resolutions in database
            console.log(`\n💾 Recording ${resolutions.length} resolutions in database...`);
            for (const res of resolutions) {
                try {
                    const existingRecord = await db
                        .select()
                        .from(userPredictionsSnapshots)
                        .where(
                            and(
                                eq(userPredictionsSnapshots.walletAddress, targetWallet),
                                eq(userPredictionsSnapshots.predictionType, res.prediction.predictionType),
                                eq(userPredictionsSnapshots.rank, res.prediction.siloIndex + 1),
                                eq(userPredictionsSnapshots.predictionTimestamp, res.prediction.predictionTimestamp)
                            )
                        )
                        .limit(1);

                    const resolutionData = {
                        priceAtPrediction: res.prediction.priceAtPrediction.toString(),
                        priceAtScoring: res.priceAtResolution.toString(),
                        actualPercentage: res.actualPercentage.toFixed(4),
                        duration: res.prediction.duration,
                        processed: true,
                        pointsEarned: res.pointsAwarded,
                        resolvedAt: new Date(),
                        solanaSignature: signature,
                        resolvedBy: 'user' as const,
                    };

                    if (existingRecord.length > 0) {
                        await db
                            .update(userPredictionsSnapshots)
                            .set(resolutionData)
                            .where(eq(userPredictionsSnapshots.id, existingRecord[0].id));
                    } else {
                        await db.insert(userPredictionsSnapshots).values({
                            walletAddress: targetWallet,
                            predictionType: res.prediction.predictionType,
                            rank: res.prediction.siloIndex + 1,
                            symbol: res.prediction.coinId,
                            predictedPercentage: res.prediction.predictedPercentage,
                            predictionTimestamp: res.prediction.predictionTimestamp,
                            resolutionTime: new Date((res.prediction.predictionTimestamp + res.prediction.duration) * 1000),
                            points: newTotalPoints,
                            snapshotTimestamp: new Date(),
                            ...resolutionData,
                        });
                    }
                } catch (dbError: any) {
                    console.error(`   ⚠️ Failed to record ${res.prediction.coinId}: ${dbError.message}`);
                }
            }

            await releaseResolutionLock(targetWallet);

            return {
                success: true,
                message: `Successfully resolved ${resolutions.length} prediction${resolutions.length > 1 ? 's' : ''} in one transaction!`,
                data: {
                    totalPredictions: resolutions.length,
                    totalPointsAwarded,
                    newTotalPoints,
                    signature,
                    resolutions: resolutions.map(r => ({
                        coinId: r.prediction.coinId,
                        predictionType: r.prediction.predictionType,
                        siloIndex: r.prediction.siloIndex,
                        pointsAwarded: r.pointsAwarded,
                        accuracyLabel: r.accuracyLabel,
                    })),
                },
            };
        } catch (error: any) {
            await releaseResolutionLock(targetWallet);
            console.error(`\n❌ Error in batch resolution:`, error);
            return {
                success: false,
                message: error.message || 'Failed to resolve predictions',
                error: 'RESOLUTION_FAILED',
            };
        }
    });

