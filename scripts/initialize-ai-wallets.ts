#!/usr/bin/env bun
/**
 * Script to initialize each AI wallet on the Solana program
 * (similar to how new users initialize themselves)
 * 
 * Usage:
 * bun run scripts/initialize-ai-wallets.ts
 */

import 'dotenv/config';
import { 
    Connection, 
    PublicKey, 
    SystemProgram, 
    Transaction, 
    TransactionInstruction,
    sendAndConfirmTransaction 
} from '@solana/web3.js';
import { AI_KEYPAIR_NAMES, getAIKeypair } from '../src/lib/ai-keypairs-utils';

const PROGRAM_ID = new PublicKey('GGw3GTVpjwLhHdsK4dY3Kb1Lb3vpz5Ns6zV3aMWcf9xe');
const INITIALIZE_USER_PREDICTIONS_DISCRIMINATOR = Buffer.from([0x3f, 0x43, 0xaa, 0x33, 0xf4, 0xff, 0x2d, 0x9f]);

function getUserPredictionsPda(userPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('user_predictions'), userPubkey.toBuffer()],
        PROGRAM_ID
    );
}

async function initializeAIWallets() {
    try {
        // Get RPC URL
        const rpcUrl = process.env.SOLANA_RPC_URL;
        if (!rpcUrl) {
            console.error('❌ SOLANA_RPC_URL environment variable is required');
            process.exit(1);
        }

        const connection = new Connection(rpcUrl, 'confirmed');

        console.log('🤖 Initializing AI wallets on FutureFrog program...\n');
        console.log(`Program ID: ${PROGRAM_ID.toBase58()}\n`);

        for (const name of AI_KEYPAIR_NAMES) {
            try {
                console.log(`📍 ${name}`);
                
                // Get the AI keypair
                const keypair = await getAIKeypair(name);
                const publicKey = keypair.publicKey;
                console.log(`   Address: ${publicKey.toBase58()}`);

                // Check if already initialized
                const [userPredictionsPda] = getUserPredictionsPda(publicKey);
                console.log(`   PDA: ${userPredictionsPda.toBase58()}`);

                const accountInfo = await connection.getAccountInfo(userPredictionsPda);
                if (accountInfo && accountInfo.data.length > 0) {
                    console.log(`   ✅ Already initialized\n`);
                    continue;
                }

                // Create initialize instruction
                const instruction = new TransactionInstruction({
                    programId: PROGRAM_ID,
                    keys: [
                        { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                        { pubkey: publicKey, isSigner: true, isWritable: true },
                        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    ],
                    data: INITIALIZE_USER_PREDICTIONS_DISCRIMINATOR,
                });

                // Create and send transaction
                const transaction = new Transaction().add(instruction);
                transaction.feePayer = publicKey;
                const { blockhash } = await connection.getLatestBlockhash();
                transaction.recentBlockhash = blockhash;

                const signature = await sendAndConfirmTransaction(
                    connection,
                    transaction,
                    [keypair],
                    { commitment: 'confirmed' }
                );

                console.log(`   ✅ Initialized successfully`);
                console.log(`   Tx: ${signature}\n`);

            } catch (err: any) {
                console.error(`   ❌ Failed to initialize ${name}:`, err.message);
                if (err.logs) {
                    console.error('   Program logs:', err.logs);
                }
                console.log('');
            }
        }

        console.log('🎉 AI wallet initialization complete!');

    } catch (error) {
        console.error('❌ Error initializing AI wallets:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
initializeAIWallets();

