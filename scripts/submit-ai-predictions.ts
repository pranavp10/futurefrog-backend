#!/usr/bin/env bun
/**
 * Script to submit AI agent predictions to the blockchain and database
 * 
 * Usage:
 * bun run scripts/submit-ai-predictions.ts <agent-name> '<json-result>'
 * 
 * Example:
 * bun run scripts/submit-ai-predictions.ts gpt-5.2 '{"market_context":...}'
 * 
 * Or pipe from a file:
 * cat prediction.json | bun run scripts/submit-ai-predictions.ts gpt-5.2
 */

import 'dotenv/config';
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
import { db } from '../src/db';
import { aiAgentPredictions, aiAgentPredictionSessions } from '../src/db/schema/ai_agent_predictions';
import { AI_KEYPAIR_NAMES, getAIKeypair, type AIKeypairName } from '../src/lib/ai-keypairs-utils';

// Program constants
const PROGRAM_ID = new PublicKey('GGw3GTVpjwLhHdsK4dY3Kb1Lb3vpz5Ns6zV3aMWcf9xe');
const ADMIN_PUBKEY = new PublicKey('J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo');
const PRICE_MULTIPLIER = 1_000_000_000; // 10^9

// Discriminator for update_silo instruction
const UPDATE_SILO_DISCRIMINATOR = Buffer.from([0xcb, 0x6b, 0x8a, 0xe3, 0xfd, 0xfb, 0x9b, 0xd3]);

// Prediction window in hours
const PREDICTION_WINDOW_HOURS = 12;

// Types for the AI prediction JSON
interface PredictionItem {
    rank: number;
    coingecko_id: string;
    symbol: string;
    current_price: number;
    expected_percentage: number;
    target_price: number;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    key_factors: string[];
}

interface MarketContext {
    overall_sentiment: 'bullish' | 'bearish' | 'neutral';
    btc_price?: number;
    btc_24h_change?: number;
    eth_price?: number;
    fear_greed_index?: number;
    btc_trend: string;
    key_observations: string[];
}

interface AIModelPrediction {
    market_context: MarketContext;
    top_performers: PredictionItem[];
    worst_performers: PredictionItem[];
    key_risks: string[];
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
    vaultType: 0 | 1, // 0 = top_performer, 1 = worst_performer
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
    percentageBuffer.writeInt16LE(Math.round(percentage * 100)); // Store as basis points
    
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

function validatePredictionJson(json: any): json is AIModelPrediction {
    if (!json.market_context || !json.top_performers || !json.worst_performers) {
        throw new Error('Missing required fields: market_context, top_performers, or worst_performers');
    }
    
    if (!Array.isArray(json.top_performers) || json.top_performers.length !== 5) {
        throw new Error('top_performers must be an array of exactly 5 items');
    }
    
    if (!Array.isArray(json.worst_performers) || json.worst_performers.length !== 5) {
        throw new Error('worst_performers must be an array of exactly 5 items');
    }

    // Validate each prediction item
    const validateItem = (item: any, type: string, index: number) => {
        const required = ['rank', 'coingecko_id', 'symbol', 'current_price', 'expected_percentage', 'target_price', 'confidence', 'reasoning'];
        for (const field of required) {
            if (item[field] === undefined) {
                throw new Error(`${type}[${index}] missing required field: ${field}`);
            }
        }
        if (type === 'top_performers' && item.expected_percentage <= 0) {
            console.warn(`Warning: ${type}[${index}] has non-positive expected_percentage: ${item.expected_percentage}`);
        }
        if (type === 'worst_performers' && item.expected_percentage >= 0) {
            console.warn(`Warning: ${type}[${index}] has non-negative expected_percentage: ${item.expected_percentage}`);
        }
    };

    json.top_performers.forEach((item: any, i: number) => validateItem(item, 'top_performers', i));
    json.worst_performers.forEach((item: any, i: number) => validateItem(item, 'worst_performers', i));

    return true;
}

async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        
        if (args.length < 1) {
            console.error('Usage: bun run scripts/submit-ai-predictions.ts <agent-name> [json-string]');
            console.error('       Or pipe JSON: cat prediction.json | bun run scripts/submit-ai-predictions.ts <agent-name>');
            console.error(`\nValid agent names: ${AI_KEYPAIR_NAMES.join(', ')}`);
            process.exit(1);
        }

        const agentName = args[0] as AIKeypairName;
        
        // Validate agent name
        if (!AI_KEYPAIR_NAMES.includes(agentName)) {
            console.error(`Invalid agent name: ${agentName}`);
            console.error(`Valid names: ${AI_KEYPAIR_NAMES.join(', ')}`);
            process.exit(1);
        }

        // Get JSON from argument or stdin
        let jsonString: string;
        if (args.length >= 2) {
            jsonString = args.slice(1).join(' ');
        } else {
            // Read from stdin
            console.log('Reading JSON from stdin...');
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) {
                chunks.push(chunk);
            }
            jsonString = Buffer.concat(chunks).toString('utf8');
        }

        // Parse and validate JSON
        let predictionData: AIModelPrediction;
        try {
            predictionData = JSON.parse(jsonString);
            validatePredictionJson(predictionData);
        } catch (e: any) {
            console.error('Invalid JSON:', e.message);
            process.exit(1);
        }

        console.log(`\n🤖 Submitting predictions for: ${agentName}`);
        console.log('='.repeat(60));

        // Get RPC URL
        const rpcUrl = process.env.SOLANA_RPC_URL;
        if (!rpcUrl) {
            console.error('❌ SOLANA_RPC_URL environment variable is required');
            process.exit(1);
        }

        const connection = new Connection(rpcUrl, 'confirmed');

        // Get the AI keypair
        const keypair = await getAIKeypair(agentName);
        const publicKey = keypair.publicKey;
        console.log(`📍 Agent wallet: ${publicKey.toBase58()}`);

        // Check balance
        const balance = await connection.getBalance(publicKey);
        console.log(`💰 Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

        if (balance < 0.01 * LAMPORTS_PER_SOL) {
            console.error('❌ Insufficient balance. Need at least 0.01 SOL for transaction fees.');
            process.exit(1);
        }

        // Create session
        const sessionId = randomUUID();
        const now = new Date();
        const resolutionTime = new Date(now.getTime() + PREDICTION_WINDOW_HOURS * 60 * 60 * 1000);
        const durationSeconds = PREDICTION_WINDOW_HOURS * 60 * 60;

        console.log(`\n📊 Market Context:`);
        console.log(`   Sentiment: ${predictionData.market_context.overall_sentiment}`);
        console.log(`   BTC: $${predictionData.market_context.btc_price?.toLocaleString() || 'N/A'}`);
        console.log(`   Fear & Greed: ${predictionData.market_context.fear_greed_index || 'N/A'}`);

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
            keyRisks: JSON.stringify(predictionData.key_risks),
        });
        console.log(`\n✅ Created prediction session: ${sessionId}`);

        // Prepare on-chain transactions
        const [userPredictionsPda] = getUserPredictionsPda(publicKey);
        const [globalStatePda] = getGlobalStatePda();

        // Build transaction with all 10 predictions
        const transaction = new Transaction();
        const predictions: Array<{
            type: 'top_performer' | 'worst_performer';
            item: PredictionItem;
            siloIndex: number;
        }> = [];

        // Add top performers (vault type 0)
        predictionData.top_performers.forEach((item, index) => {
            predictions.push({ type: 'top_performer', item, siloIndex: index });
        });

        // Add worst performers (vault type 1)
        predictionData.worst_performers.forEach((item, index) => {
            predictions.push({ type: 'worst_performer', item, siloIndex: index });
        });

        console.log(`\n📝 Top Performers:`);
        predictionData.top_performers.forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.symbol} (${p.coingecko_id}): +${p.expected_percentage.toFixed(2)}% [${p.confidence}]`);
        });

        console.log(`\n📉 Worst Performers:`);
        predictionData.worst_performers.forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.symbol} (${p.coingecko_id}): ${p.expected_percentage.toFixed(2)}% [${p.confidence}]`);
        });

        // Create instructions for each prediction
        for (const pred of predictions) {
            const vaultType = pred.type === 'top_performer' ? 0 : 1;
            const priceU64 = priceToU64(pred.item.current_price);
            const durationI64 = BigInt(durationSeconds);

            const instructionData = createUpdateSiloInstructionData(
                vaultType as 0 | 1,
                pred.siloIndex,
                pred.item.coingecko_id, // Use coingecko_id as the silo value
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
        console.log('\n🚀 Submitting on-chain predictions...');
        transaction.feePayer = publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;

        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [keypair],
            { commitment: 'confirmed' }
        );

        console.log(`✅ Transaction confirmed: ${signature}`);

        // Insert predictions into database
        console.log('\n💾 Saving predictions to database...');
        
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
        console.log(`✅ Saved ${dbPredictions.length} predictions to database`);

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('🎉 PREDICTION SUBMISSION COMPLETE');
        console.log('='.repeat(60));
        console.log(`Agent: ${agentName}`);
        console.log(`Session ID: ${sessionId}`);
        console.log(`Transaction: ${signature}`);
        console.log(`Resolution Time: ${resolutionTime.toISOString()}`);
        console.log(`Explorer: https://solscan.io/tx/${signature}`);

    } catch (error: any) {
        console.error('\n❌ Error submitting predictions:', error.message);
        if (error.logs) {
            console.error('\nProgram logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
main();

