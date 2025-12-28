import { Elysia } from 'elysia';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getBuyBackKeypair } from '../lib/buyback-utils';
import { fetchHistoricalPriceForResolution } from '../lib/historical-price';

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'GGw3GTVpjwLhHdsK4dY3Kb1Lb3vpz5Ns6zV3aMWcf9xe');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PRICE_MULTIPLIER = 1_000_000_000; // 9 decimals

// Instruction discriminators
const ADMIN_SET_RESOLUTION_PRICE_IX = Buffer.from([0xcb, 0x7e, 0x48, 0x89, 0xa4, 0xfc, 0xb3, 0x89]); // admin_set_resolution_price
const UPDATE_USER_POINTS_IX = Buffer.from([0x40, 0x04, 0xb8, 0x7e, 0x00, 0x2e, 0xc4, 0x9f]);

interface ResolvePredictionRequest {
    walletAddress: string;
    predictionType: 'top_performer' | 'worst_performer';
    siloIndex: number;
}

interface ResolutionResult {
    success: boolean;
    message: string;
    data?: {
        coinId: string;
        predictionTimestamp: number;
        resolutionTimestamp: number;
        priceAtPrediction: number;
        priceAtResolution: number;
        predictedPercentage: number;
        actualPercentage: number;
        accuracyLabel: string;
        pointsAwarded: number;
        newTotalPoints: number;
        signature: string;
    };
    error?: string;
}

/**
 * Calculate points based on accuracy of prediction
 */
function calculateAccuracyPoints(
    predictedPercentage: number,
    actualPercentage: number,
    predictionType: 'top_performer' | 'worst_performer'
): { points: number; label: string } {
    // Check direction first
    // top_performer expects price to go UP (positive %)
    // worst_performer expects price to go DOWN (negative %)
    const expectedDirection = predictionType === 'top_performer' ? 'up' : 'down';
    const actualDirection = actualPercentage >= 0 ? 'up' : 'down';

    if (expectedDirection !== actualDirection) {
        return { points: 10, label: 'wrong_direction' };
    }

    // Direction is correct, now check accuracy
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
 * Parse user predictions from blockchain account data
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

    // Read top_performer array (5 fixed 32-byte strings)
    const topPerformer: string[] = [];
    for (let i = 0; i < 5; i++) {
        topPerformer.push(parseFixedString(data.slice(offset, offset + 32)));
        offset += 32;
    }

    // Read worst_performer array (5 fixed 32-byte strings)
    const worstPerformer: string[] = [];
    for (let i = 0; i < 5; i++) {
        worstPerformer.push(parseFixedString(data.slice(offset, offset + 32)));
        offset += 32;
    }

    // Read timestamps
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

    // Read percentages
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

    // Read prices
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

    // Skip resolution prices (we don't need them for reading)
    offset += 8 * 5 * 2; // top + worst resolution prices

    // Read durations
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

export const resolvePredictionRoutes = new Elysia()
    .post('/resolve-prediction', async ({ body }): Promise<ResolutionResult> => {
        const { walletAddress, predictionType, siloIndex } = body as ResolvePredictionRequest;

        console.log(`\n========================================`);
        console.log(`🎯 Resolving Prediction`);
        console.log(`   Wallet: ${walletAddress}`);
        console.log(`   Type: ${predictionType}`);
        console.log(`   Silo Index: ${siloIndex}`);
        console.log(`========================================\n`);

        try {
            const connection = new Connection(RPC_URL, 'confirmed');
            const userPubkey = new PublicKey(walletAddress);

            // Get user predictions PDA
            const [userPredictionsPda] = PublicKey.findProgramAddressSync(
                [Buffer.from('user_predictions'), userPubkey.toBuffer()],
                PROGRAM_ID
            );

            // Fetch account data
            const accountInfo = await connection.getAccountInfo(userPredictionsPda);
            if (!accountInfo) {
                return {
                    success: false,
                    message: 'User predictions account not found',
                    error: 'ACCOUNT_NOT_FOUND',
                };
            }

            const predictions = parseUserPredictionsAccount(accountInfo.data as Buffer);

            // Get the specific prediction data
            const isTopPerformer = predictionType === 'top_performer';
            const coinId = isTopPerformer
                ? predictions.topPerformer[siloIndex]
                : predictions.worstPerformer[siloIndex];
            const predictionTimestamp = isTopPerformer
                ? predictions.topPerformerTimestamps[siloIndex]
                : predictions.worstPerformerTimestamps[siloIndex];
            const predictedPercentage = isTopPerformer
                ? predictions.topPerformerPercentages[siloIndex]
                : predictions.worstPerformerPercentages[siloIndex];
            const priceAtPredictionU64 = isTopPerformer
                ? predictions.topPerformerPrices[siloIndex]
                : predictions.worstPerformerPrices[siloIndex];
            const duration = isTopPerformer
                ? predictions.topPerformerDurations[siloIndex]
                : predictions.worstPerformerDurations[siloIndex];

            // Validate prediction exists
            if (!coinId || coinId.trim() === '') {
                return {
                    success: false,
                    message: 'No prediction found in this slot',
                    error: 'EMPTY_SLOT',
                };
            }

            if (!predictionTimestamp || predictionTimestamp === 0) {
                return {
                    success: false,
                    message: 'Prediction has no timestamp',
                    error: 'NO_TIMESTAMP',
                };
            }

            if (!duration || duration === 0) {
                return {
                    success: false,
                    message: 'Prediction has no duration set',
                    error: 'NO_DURATION',
                };
            }

            // Calculate resolution time
            const resolutionTimestamp = predictionTimestamp + duration;
            const now = Math.floor(Date.now() / 1000);

            if (now < resolutionTimestamp) {
                const remainingSeconds = resolutionTimestamp - now;
                const remainingMinutes = Math.ceil(remainingSeconds / 60);
                return {
                    success: false,
                    message: `Prediction not ready for resolution yet. ${remainingMinutes} minutes remaining.`,
                    error: 'NOT_READY',
                };
            }

            console.log(`📊 Prediction Details (from blockchain):`);
            console.log(`   CoinGecko ID: ${coinId}`);
            console.log(`   Prediction Timestamp: ${predictionTimestamp} (${new Date(predictionTimestamp * 1000).toISOString()})`);
            console.log(`   Duration: ${duration} seconds (${Math.floor(duration / 60)} minutes)`);
            console.log(`   Resolution Timestamp: ${resolutionTimestamp} (${new Date(resolutionTimestamp * 1000).toISOString()})`);
            console.log(`   Predicted %: ${predictedPercentage}%`);
            console.log(`   Price at Prediction (u64): ${priceAtPredictionU64}`);

            // Fetch historical price at resolution time - ALWAYS fresh from CoinGecko (no caching)
            console.log(`\n📡 Fetching resolution price from CoinGecko (no cache)...`);
            const priceAtResolution = await fetchHistoricalPriceForResolution(coinId, resolutionTimestamp);

            if (priceAtResolution === null) {
                return {
                    success: false,
                    message: `Could not fetch price for ${coinId} at resolution time. Please try again later.`,
                    error: 'PRICE_FETCH_FAILED',
                };
            }

            // Calculate actual percentage change
            const priceAtPrediction = Number(priceAtPredictionU64) / PRICE_MULTIPLIER;
            const actualPercentage = ((priceAtResolution - priceAtPrediction) / priceAtPrediction) * 100;

            console.log(`\n💰 Price Comparison:`);
            console.log(`   Price at Prediction: $${priceAtPrediction.toFixed(6)}`);
            console.log(`   Price at Resolution: $${priceAtResolution.toFixed(6)}`);
            console.log(`   Actual Change: ${actualPercentage.toFixed(2)}%`);
            console.log(`   Predicted Change: ${predictedPercentage}%`);

            // Calculate points
            const { points: pointsAwarded, label: accuracyLabel } = calculateAccuracyPoints(
                predictedPercentage,
                actualPercentage,
                predictionType
            );

            console.log(`\n🎯 Scoring:`);
            console.log(`   Accuracy: ${accuracyLabel}`);
            console.log(`   Points Awarded: ${pointsAwarded}`);

            // Get admin keypair
            const adminKeypair = await getBuyBackKeypair();
            console.log(`\n🔑 Admin keypair loaded: ${adminKeypair.publicKey.toBase58()}`);

            // Get global state PDA
            const [globalStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from('global_state')],
                PROGRAM_ID
            );

            // Convert resolution price to u64
            const resolutionPriceU64 = BigInt(Math.floor(priceAtResolution * PRICE_MULTIPLIER));

            // Build transaction with two instructions:
            // 1. Set resolution price
            // 2. Update user points

            const transaction = new Transaction();

            // Instruction 1: admin_set_resolution_price
            const vaultTypeByte = isTopPerformer ? 0 : 1;
            const resolutionPriceBuffer = Buffer.alloc(8);
            resolutionPriceBuffer.writeBigUInt64LE(resolutionPriceU64);

            const setResolutionPriceIx = new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [
                    { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                    { pubkey: globalStatePda, isSigner: false, isWritable: false },
                    { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
                ],
                data: Buffer.concat([
                    ADMIN_SET_RESOLUTION_PRICE_IX,
                    Buffer.from([vaultTypeByte]),
                    Buffer.from([siloIndex]),
                    resolutionPriceBuffer,
                ]),
            });
            transaction.add(setResolutionPriceIx);

            // Instruction 2: update_user_points
            const newTotalPoints = predictions.points + pointsAwarded;
            const pointsBuffer = Buffer.alloc(8);
            pointsBuffer.writeBigUInt64LE(BigInt(newTotalPoints));

            const updatePointsIx = new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [
                    { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                    { pubkey: globalStatePda, isSigner: false, isWritable: false },
                    { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
                ],
                data: Buffer.concat([UPDATE_USER_POINTS_IX, pointsBuffer]),
            });
            transaction.add(updatePointsIx);

            // Send transaction
            const { blockhash } = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = adminKeypair.publicKey;
            transaction.sign(adminKeypair);

            console.log(`\n📤 Sending transaction...`);
            const signature = await connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
            });

            await connection.confirmTransaction(signature, 'confirmed');

            console.log(`\n✅ Transaction confirmed: ${signature}`);

            return {
                success: true,
                message: `Prediction resolved! You earned ${pointsAwarded} points (${accuracyLabel})`,
                data: {
                    coinId,
                    predictionTimestamp,
                    resolutionTimestamp,
                    priceAtPrediction,
                    priceAtResolution,
                    predictedPercentage,
                    actualPercentage: Math.round(actualPercentage * 100) / 100,
                    accuracyLabel,
                    pointsAwarded,
                    newTotalPoints,
                    signature,
                },
            };
        } catch (error: any) {
            console.error(`\n❌ Error resolving prediction:`, error);
            return {
                success: false,
                message: error.message || 'Failed to resolve prediction',
                error: 'RESOLUTION_FAILED',
            };
        }
    });

