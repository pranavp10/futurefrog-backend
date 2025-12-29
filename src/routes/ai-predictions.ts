import { Elysia, t } from 'elysia';
import { 
    Connection, 
    PublicKey, 
    SystemProgram, 
    Transaction, 
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { aiAgentPredictions, aiAgentPredictionSessions } from '../db/schema/ai_agent_predictions';
import { AI_KEYPAIR_NAMES, getAIKeypair, getAIPublicKey, type AIKeypairName } from '../lib/ai-keypairs-utils';
import { getRedisClient, AI_PREDICTIONS_CACHE_TTL, AI_PREDICTIONS_CACHE_PREFIX } from '../lib/redis';

// Program constants
const PROGRAM_ID = new PublicKey('GGw3GTVpjwLhHdsK4dY3Kb1Lb3vpz5Ns6zV3aMWcf9xe');
const ADMIN_PUBKEY = new PublicKey('J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo');
const PRICE_MULTIPLIER = 1_000_000_000;
const UPDATE_SILO_DISCRIMINATOR = Buffer.from([0xcb, 0x6b, 0x8a, 0xe3, 0xfd, 0xfb, 0x9b, 0xd3]);
const PREDICTION_WINDOW_HOURS = 12;

// Types
interface PredictionItem {
    rank: number;
    coingecko_id: string;
    symbol: string;
    current_price: number;
    expected_percentage: number;
    target_price: number;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    key_factors?: string[];
}

interface MarketContext {
    overall_sentiment: 'bullish' | 'bearish' | 'neutral';
    btc_price?: number;
    btc_24h_change?: number;
    eth_price?: number;
    fear_greed_index?: number;
    btc_trend?: string;
    key_observations?: string[];
}

interface AIModelPrediction {
    market_context: MarketContext;
    top_performers: PredictionItem[];
    worst_performers: PredictionItem[];
    key_risks?: string[];
    research_sources?: string[];
}

// Helper functions
function getUserPredictionsPda(userPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('user_predictions'), userPubkey.toBuffer()],
        PROGRAM_ID
    );
}

function getGlobalStatePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('global_state')],
        PROGRAM_ID
    );
}

function priceToU64(priceInDollars: number): bigint {
    return BigInt(Math.floor(priceInDollars * PRICE_MULTIPLIER));
}

function createUpdateSiloInstructionData(
    vaultType: 0 | 1,
    siloIndex: number,
    value: string,
    percentage: number,
    price: bigint,
    duration: bigint
): Buffer {
    const valueBuffer = Buffer.from(value, 'utf8');
    const valueLengthBuffer = Buffer.alloc(4);
    valueLengthBuffer.writeUInt32LE(valueBuffer.length);
    
    const percentageBuffer = Buffer.alloc(2);
    percentageBuffer.writeInt16LE(Math.round(percentage * 100));
    
    const priceBuffer = Buffer.alloc(8);
    priceBuffer.writeBigUInt64LE(price);
    
    const durationBuffer = Buffer.alloc(8);
    durationBuffer.writeBigInt64LE(duration);

    return Buffer.concat([
        UPDATE_SILO_DISCRIMINATOR,
        Buffer.from([vaultType]),
        Buffer.from([siloIndex]),
        valueLengthBuffer,
        valueBuffer,
        percentageBuffer,
        priceBuffer,
        durationBuffer,
    ]);
}

function validatePredictionJson(json: any): { valid: boolean; error?: string } {
    if (!json.market_context || !json.top_performers || !json.worst_performers) {
        return { valid: false, error: 'Missing required fields: market_context, top_performers, or worst_performers' };
    }
    
    if (!Array.isArray(json.top_performers) || json.top_performers.length !== 5) {
        return { valid: false, error: 'top_performers must be an array of exactly 5 items' };
    }
    
    if (!Array.isArray(json.worst_performers) || json.worst_performers.length !== 5) {
        return { valid: false, error: 'worst_performers must be an array of exactly 5 items' };
    }

    const required = ['rank', 'coingecko_id', 'symbol', 'current_price', 'expected_percentage', 'target_price', 'confidence', 'reasoning'];
    
    for (let i = 0; i < json.top_performers.length; i++) {
        const item = json.top_performers[i];
        for (const field of required) {
            if (item[field] === undefined) {
                return { valid: false, error: `top_performers[${i}] missing required field: ${field}` };
            }
        }
    }

    for (let i = 0; i < json.worst_performers.length; i++) {
        const item = json.worst_performers[i];
        for (const field of required) {
            if (item[field] === undefined) {
                return { valid: false, error: `worst_performers[${i}] missing required field: ${field}` };
            }
        }
    }

    return { valid: true };
}

export const aiPredictionsRoutes = new Elysia({ prefix: '/api/ai-predictions' })
    // Get available agents
    .get('/agents', () => {
        return {
            success: true,
            data: {
                agents: AI_KEYPAIR_NAMES,
            },
        };
    })

    // Get recent prediction sessions
    .get('/sessions', async ({ query, set }) => {
        try {
            const limit = parseInt(query.limit || '20');
            const agentName = query.agent;

            let queryBuilder = db
                .select()
                .from(aiAgentPredictionSessions)
                .orderBy(desc(aiAgentPredictionSessions.sessionTimestamp))
                .limit(limit);

            const sessions = agentName 
                ? await db
                    .select()
                    .from(aiAgentPredictionSessions)
                    .where(eq(aiAgentPredictionSessions.agentName, agentName))
                    .orderBy(desc(aiAgentPredictionSessions.sessionTimestamp))
                    .limit(limit)
                : await queryBuilder;

            return {
                success: true,
                data: { sessions },
            };
        } catch (error) {
            console.error('Error fetching sessions:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch sessions',
            };
        }
    })

    // Get predictions for a session
    .get('/sessions/:sessionId', async ({ params, set }) => {
        try {
            const predictions = await db
                .select()
                .from(aiAgentPredictions)
                .where(eq(aiAgentPredictions.sessionId, params.sessionId));

            const session = await db
                .select()
                .from(aiAgentPredictionSessions)
                .where(eq(aiAgentPredictionSessions.id, params.sessionId))
                .limit(1);

            return {
                success: true,
                data: {
                    session: session[0] || null,
                    predictions,
                },
            };
        } catch (error) {
            console.error('Error fetching session:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch session',
            };
        }
    })

    // Validate prediction JSON
    .post('/validate', async ({ body, set }) => {
        try {
            const { predictionJson } = body as { predictionJson: string };
            
            let parsed;
            try {
                parsed = JSON.parse(predictionJson);
            } catch (e) {
                return {
                    success: false,
                    error: 'Invalid JSON format',
                };
            }

            const validation = validatePredictionJson(parsed);
            
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                };
            }

            return {
                success: true,
                data: {
                    valid: true,
                    summary: {
                        topPerformers: parsed.top_performers.map((p: PredictionItem) => ({
                            symbol: p.symbol,
                            expectedPercentage: p.expected_percentage,
                        })),
                        worstPerformers: parsed.worst_performers.map((p: PredictionItem) => ({
                            symbol: p.symbol,
                            expectedPercentage: p.expected_percentage,
                        })),
                        marketSentiment: parsed.market_context.overall_sentiment,
                    },
                },
            };
        } catch (error) {
            console.error('Error validating prediction:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Validation failed',
            };
        }
    })

    // Submit predictions
    .post('/submit', async ({ body, set }) => {
        try {
            const { agentName, predictionJson } = body as { agentName: string; predictionJson: string };

            // Validate agent name
            if (!AI_KEYPAIR_NAMES.includes(agentName as AIKeypairName)) {
                set.status = 400;
                return {
                    success: false,
                    error: `Invalid agent name. Valid names: ${AI_KEYPAIR_NAMES.join(', ')}`,
                };
            }

            // Parse and validate JSON
            let predictionData: AIModelPrediction;
            try {
                predictionData = JSON.parse(predictionJson);
            } catch (e) {
                set.status = 400;
                return {
                    success: false,
                    error: 'Invalid JSON format',
                };
            }

            const validation = validatePredictionJson(predictionData);
            if (!validation.valid) {
                set.status = 400;
                return {
                    success: false,
                    error: validation.error,
                };
            }

            // Get RPC URL
            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                set.status = 500;
                return {
                    success: false,
                    error: 'SOLANA_RPC_URL not configured',
                };
            }

            const connection = new Connection(rpcUrl, 'confirmed');

            // Get the AI keypair
            const keypair = await getAIKeypair(agentName as AIKeypairName);
            const publicKey = keypair.publicKey;

            // Check balance
            const balance = await connection.getBalance(publicKey);
            if (balance < 0.01 * LAMPORTS_PER_SOL) {
                set.status = 400;
                return {
                    success: false,
                    error: `Insufficient balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL. Need at least 0.01 SOL.`,
                };
            }

            // Create session
            const sessionId = randomUUID();
            const now = new Date();
            const resolutionTime = new Date(now.getTime() + PREDICTION_WINDOW_HOURS * 60 * 60 * 1000);
            const durationSeconds = PREDICTION_WINDOW_HOURS * 60 * 60;

            // Create session in database
            await db.insert(aiAgentPredictionSessions).values({
                id: sessionId,
                agentName,
                sessionTimestamp: now,
                predictionWindowHours: PREDICTION_WINDOW_HOURS,
                resolutionTimestamp: resolutionTime,
                btcPrice: predictionData.market_context.btc_price?.toString(),
                ethPrice: predictionData.market_context.eth_price?.toString(),
                fearGreedIndex: predictionData.market_context.fear_greed_index,
                marketSentiment: predictionData.market_context.overall_sentiment,
                marketContext: JSON.stringify({
                    btc_trend: predictionData.market_context.btc_trend,
                    key_observations: predictionData.market_context.key_observations,
                    research_sources: predictionData.research_sources || [],
                }),
                keyRisks: JSON.stringify(predictionData.key_risks || []),
            });

            // Prepare predictions
            const [userPredictionsPda] = getUserPredictionsPda(publicKey);
            const [globalStatePda] = getGlobalStatePda();

            const transaction = new Transaction();
            const predictions: Array<{
                type: 'top_performer' | 'worst_performer';
                item: PredictionItem;
                siloIndex: number;
            }> = [];

            predictionData.top_performers.forEach((item, index) => {
                predictions.push({ type: 'top_performer', item, siloIndex: index });
            });

            predictionData.worst_performers.forEach((item, index) => {
                predictions.push({ type: 'worst_performer', item, siloIndex: index });
            });

            // Create instructions
            for (const pred of predictions) {
                const vaultType = pred.type === 'top_performer' ? 0 : 1;
                const priceU64 = priceToU64(pred.item.current_price);
                const durationI64 = BigInt(durationSeconds);

                const instructionData = createUpdateSiloInstructionData(
                    vaultType as 0 | 1,
                    pred.siloIndex,
                    pred.item.coingecko_id,
                    pred.item.expected_percentage,
                    priceU64,
                    durationI64
                );

                const instruction = new TransactionInstruction({
                    programId: PROGRAM_ID,
                    keys: [
                        { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                        { pubkey: globalStatePda, isSigner: false, isWritable: false },
                        { pubkey: publicKey, isSigner: true, isWritable: true },
                        { pubkey: ADMIN_PUBKEY, isSigner: false, isWritable: true },
                        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    ],
                    data: instructionData,
                });

                transaction.add(instruction);
            }

            // Send transaction
            transaction.feePayer = publicKey;
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;

            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [keypair],
                { commitment: 'confirmed' }
            );

            // Insert predictions into database
            const dbPredictions = predictions.map(pred => ({
                sessionId,
                agentName,
                predictionType: pred.type,
                rank: pred.siloIndex + 1,
                coingeckoId: pred.item.coingecko_id,
                symbol: pred.item.symbol,
                priceAtPrediction: pred.item.current_price.toString(),
                targetPrice: pred.item.target_price.toString(),
                expectedPercentage: pred.item.expected_percentage.toString(),
                confidence: pred.item.confidence,
                reasoning: pred.item.reasoning,
                keyFactors: JSON.stringify(pred.item.key_factors || []),
                predictionTimestamp: now,
                predictionWindowHours: PREDICTION_WINDOW_HOURS,
                resolutionTimestamp: resolutionTime,
                marketContext: JSON.stringify(predictionData.market_context),
                onChainSubmitted: true,
                solanaSignature: signature,
            }));

            await db.insert(aiAgentPredictions).values(dbPredictions);

            return {
                success: true,
                data: {
                    sessionId,
                    agentName,
                    signature,
                    explorerUrl: `https://solscan.io/tx/${signature}`,
                    predictionsCount: predictions.length,
                    resolutionTime: resolutionTime.toISOString(),
                    topPerformers: predictionData.top_performers.map(p => ({
                        symbol: p.symbol,
                        expectedPercentage: p.expected_percentage,
                    })),
                    worstPerformers: predictionData.worst_performers.map(p => ({
                        symbol: p.symbol,
                        expectedPercentage: p.expected_percentage,
                    })),
                },
            };
        } catch (error: any) {
            console.error('Error submitting predictions:', error);
            set.status = 500;
            return {
                success: false,
                error: error.message || 'Failed to submit predictions',
                logs: error.logs || undefined,
            };
        }
    })

    // Get on-chain predictions for an AI agent
    .get('/onchain/:agentName', async ({ params, set }) => {
        try {
            const { agentName } = params;

            if (!AI_KEYPAIR_NAMES.includes(agentName as AIKeypairName)) {
                set.status = 400;
                return {
                    success: false,
                    error: `Invalid agent name. Valid names: ${AI_KEYPAIR_NAMES.join(', ')}`,
                };
            }

            // Check Redis cache first
            const cacheKey = `${AI_PREDICTIONS_CACHE_PREFIX}${agentName}`;
            const redis = getRedisClient();
            
            try {
                const cachedData = await redis.get(cacheKey);
                if (cachedData) {
                    console.log(`📦 Cache hit for AI predictions: ${agentName}`);
                    return JSON.parse(cachedData);
                }
            } catch (cacheErr) {
                console.warn('Redis cache read failed, continuing with blockchain fetch:', cacheErr);
            }

            console.log(`🔗 Cache miss, fetching from blockchain: ${agentName}`);

            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                set.status = 500;
                return { success: false, error: 'SOLANA_RPC_URL not configured' };
            }

            const connection = new Connection(rpcUrl, 'confirmed');
            const publicKey = await getAIPublicKey(agentName as AIKeypairName);
            const pubkey = new PublicKey(publicKey);
            const [userPredictionsPda] = getUserPredictionsPda(pubkey);

            const accountInfo = await connection.getAccountInfo(userPredictionsPda);

            if (!accountInfo || accountInfo.data.length === 0) {
                const result = {
                    success: true,
                    data: {
                        initialized: false,
                        agentName,
                        publicKey,
                    },
                };
                // Cache even uninitialized state (shorter TTL - 1 minute)
                try {
                    await redis.setex(cacheKey, 60, JSON.stringify(result));
                } catch (cacheErr) {
                    console.warn('Redis cache write failed:', cacheErr);
                }
                return result;
            }

            // Parse account data - same layout as frontend
            const data = accountInfo.data;
            const parseFixedString = (bytes: Uint8Array): string => {
                return new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
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
            const topPerformerPrices: number[] = [];
            for (let i = 0; i < 5; i++) {
                topPerformerPrices.push(Number(data.readBigUInt64LE(offset)) / PRICE_MULTIPLIER);
                offset += 8;
            }

            const worstPerformerPrices: number[] = [];
            for (let i = 0; i < 5; i++) {
                worstPerformerPrices.push(Number(data.readBigUInt64LE(offset)) / PRICE_MULTIPLIER);
                offset += 8;
            }

            // Read resolution prices
            const topPerformerResolutionPrices: number[] = [];
            for (let i = 0; i < 5; i++) {
                topPerformerResolutionPrices.push(Number(data.readBigUInt64LE(offset)) / PRICE_MULTIPLIER);
                offset += 8;
            }

            const worstPerformerResolutionPrices: number[] = [];
            for (let i = 0; i < 5; i++) {
                worstPerformerResolutionPrices.push(Number(data.readBigUInt64LE(offset)) / PRICE_MULTIPLIER);
                offset += 8;
            }

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
            offset += 8;
            const lastUpdated = Number(data.readBigInt64LE(offset));

            // Get balance
            const balance = await connection.getBalance(pubkey);

            const result = {
                success: true,
                data: {
                    initialized: true,
                    agentName,
                    publicKey,
                    balance: balance / LAMPORTS_PER_SOL,
                    points,
                    predictionCount,
                    lastUpdated,
                    topPerformer,
                    worstPerformer,
                    topPerformerTimestamps,
                    worstPerformerTimestamps,
                    topPerformerPercentages,
                    worstPerformerPercentages,
                    topPerformerPrices,
                    worstPerformerPrices,
                    topPerformerResolutionPrices,
                    worstPerformerResolutionPrices,
                    topPerformerDurations,
                    worstPerformerDurations,
                },
            };

            // Cache the result for 5 minutes
            try {
                await redis.setex(cacheKey, AI_PREDICTIONS_CACHE_TTL, JSON.stringify(result));
                console.log(`💾 Cached AI predictions for ${agentName} (TTL: ${AI_PREDICTIONS_CACHE_TTL}s)`);
            } catch (cacheErr) {
                console.warn('Redis cache write failed:', cacheErr);
            }

            return result;
        } catch (error: any) {
            console.error('Error fetching on-chain predictions:', error);
            set.status = 500;
            return {
                success: false,
                error: error.message || 'Failed to fetch predictions',
            };
        }
    })

    // Resolve an AI agent prediction
    .post('/resolve', async ({ body, set }) => {
        try {
            const { agentName, predictionType, siloIndex } = body as {
                agentName: string;
                predictionType: 'top_performer' | 'worst_performer';
                siloIndex: number;
            };

            if (!AI_KEYPAIR_NAMES.includes(agentName as AIKeypairName)) {
                set.status = 400;
                return {
                    success: false,
                    error: `Invalid agent name. Valid names: ${AI_KEYPAIR_NAMES.join(', ')}`,
                };
            }

            // Get the AI agent's public key
            const publicKey = await getAIPublicKey(agentName as AIKeypairName);

            // Forward to the existing resolve-prediction endpoint
            const resolveUrl = `${process.env.BACKEND_URL || 'http://localhost:8000'}/resolve-prediction`;
            
            const response = await fetch(resolveUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: publicKey,
                    predictionType,
                    siloIndex,
                }),
            });

            const result = await response.json();

            // Invalidate cache after successful resolution
            if (result.success) {
                try {
                    const redis = getRedisClient();
                    const cacheKey = `${AI_PREDICTIONS_CACHE_PREFIX}${agentName}`;
                    await redis.del(cacheKey);
                    console.log(`🗑️ Cache invalidated for ${agentName} after resolution`);
                } catch (cacheErr) {
                    console.warn('Redis cache invalidation failed:', cacheErr);
                }
            }

            return result;
        } catch (error: any) {
            console.error('Error resolving AI prediction:', error);
            set.status = 500;
            return {
                success: false,
                error: error.message || 'Failed to resolve prediction',
            };
        }
    });

