#!/usr/bin/env bun
/**
 * Script to clear a user's predictions (without affecting points) using the admin keypair
 * 
 * This script:
 * 1. Reads the admin keypair from the global_params table (encrypted)
 * 2. Decrypts the keypair using the SALT environment variable
 * 3. Reads the current user predictions and points from the blockchain
 * 4. Calls the admin_clear_user_silos instruction on the Solana program
 * 5. Verifies the predictions were cleared (but points remain intact)
 * 
 * Usage:
 *   bun run scripts/clear-user-predictions.ts <user_address>
 * 
 * Example:
 *   bun run scripts/clear-user-predictions.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
 */

import 'dotenv/config';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getBuyBackKeypair } from '../src/lib/buyback-utils';

// Validate environment variables
if (!process.env.PROGRAM_ID) {
    console.error('❌ Error: PROGRAM_ID environment variable is required');
    console.error('Please add PROGRAM_ID to your .env file');
    process.exit(1);
}

// Program constants
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
const ADMIN_CLEAR_USER_SILOS_IX = Buffer.from([0x72, 0xee, 0x6d, 0xd7, 0xf7, 0xac, 0x3c, 0xe9]);
const EXPECTED_ADMIN = new PublicKey('J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo');

// Helper to parse fixed-length strings from blockchain data
function parseFixedString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes).trimEnd();
}

async function clearUserPredictions() {
    try {
        const args = process.argv.slice(2);

        if (args.length < 1) {
            console.error('❌ Error: Please provide user address');
            console.error('\nUsage: bun run scripts/clear-user-predictions.ts <user_address>');
            console.error('Example: bun run scripts/clear-user-predictions.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
            process.exit(1);
        }

        // Parse user address
        let userPubkey: PublicKey;
        try {
            userPubkey = new PublicKey(args[0]);
        } catch (e) {
            console.error('❌ Error: Invalid user address');
            process.exit(1);
        }

        console.log('=' .repeat(60));
        console.log('🧹 Clear User Predictions (Preserve Points)');
        console.log('='.repeat(60));
        console.log(`📅 Timestamp: ${new Date().toISOString()}`);
        console.log(`🔧 Program ID: ${PROGRAM_ID.toBase58()}`);

        // Get admin keypair from database
        console.log('\n🔓 Step 1: Retrieving admin keypair from database...');
        const startKeypairRetrieval = Date.now();
        const adminKeypair = await getBuyBackKeypair();
        console.log(`   ✅ Admin Public Key: ${adminKeypair.publicKey.toBase58()}`);
        console.log(`   ⏱️  Time taken: ${Date.now() - startKeypairRetrieval}ms`);

        // Verify it's the expected admin
        console.log('\n🔍 Step 2: Verifying admin keypair...');
        if (adminKeypair.publicKey.toBase58() !== EXPECTED_ADMIN.toBase58()) {
            console.error('   ❌ Error: Retrieved keypair does not match expected admin!');
            console.error(`   Retrieved: ${adminKeypair.publicKey.toBase58()}`);
            console.error(`   Expected: ${EXPECTED_ADMIN.toBase58()}`);
            process.exit(1);
        }
        console.log('   ✅ Admin keypair verified');

        // Setup Solana connection
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        const connection = new Connection(rpcUrl, 'confirmed');

        console.log('\n📡 Connection Details:');
        console.log(`   RPC URL: ${rpcUrl}`);
        console.log(`   Target User: ${userPubkey.toBase58()}`);

        // Derive PDAs
        console.log('\n🔑 Step 3: Deriving PDAs...');
        const [globalStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('global_state')],
            PROGRAM_ID
        );

        const [userPredictionsPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('user_predictions'), userPubkey.toBuffer()],
            PROGRAM_ID
        );

        console.log(`   Global State PDA: ${globalStatePda.toBase58()}`);
        console.log(`   User Predictions PDA: ${userPredictionsPda.toBase58()}`);

        // Check if user account exists
        console.log('\n🔍 Step 4: Reading current user data from blockchain...');
        const startAccountFetch = Date.now();
        const userAccount = await connection.getAccountInfo(userPredictionsPda);
        console.log(`   ⏱️  Account fetch time: ${Date.now() - startAccountFetch}ms`);
        
        if (!userAccount) {
            console.error('   ❌ Error: User predictions account not found!');
            console.error('   This user has not initialized their predictions yet.');
            process.exit(1);
        }
        console.log('   ✅ User account found');
        console.log(`   📦 Account data size: ${userAccount.data.length} bytes`);

        // Parse current predictions and points
        const data = userAccount.data;
        let offset = 40; // Skip discriminator (8) + owner (32)

        // Read top_performer array (5 fixed 6-byte strings)
        const topPerformer: string[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformer.push(parseFixedString(data.slice(offset, offset + 6)));
            offset += 6;
        }

        // Read worst_performer array (5 fixed 6-byte strings)
        const worstPerformer: string[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformer.push(parseFixedString(data.slice(offset, offset + 6)));
            offset += 6;
        }

        // Skip timestamps (40 bytes for top + 40 bytes for worst)
        offset += 80;

        // Read points
        const currentPoints = data.readBigUInt64LE(offset);
        
        console.log('\n   📊 Current State:');
        console.log(`   Points: ${currentPoints.toString()}`);
        console.log(`   Top Performers: [${topPerformer.map(s => s || '(empty)').join(', ')}]`);
        console.log(`   Worst Performers: [${worstPerformer.map(s => s || '(empty)').join(', ')}]`);

        // Check if already empty
        const allEmpty = topPerformer.every(s => !s || s.trim() === '') && 
                        worstPerformer.every(s => !s || s.trim() === '');
        
        if (allEmpty) {
            console.log('\n   ℹ️  All predictions are already empty. Nothing to clear.');
            console.log('   Points remain: ' + currentPoints.toString());
            process.exit(0);
        }

        // Create instruction
        console.log('\n🔨 Step 5: Building transaction...');
        console.log(`   📝 Instruction discriminator: ${ADMIN_CLEAR_USER_SILOS_IX.toString('hex')}`);

        const instruction = new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                { pubkey: globalStatePda, isSigner: false, isWritable: false },
                { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
            ],
            data: ADMIN_CLEAR_USER_SILOS_IX,
        });
        console.log('   ✅ Transaction instruction created');

        console.log('\n📤 Step 6: Sending transaction to Solana...');

        // Create and send transaction
        const startTxBuild = Date.now();
        const transaction = new Transaction().add(instruction);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = adminKeypair.publicKey;
        transaction.sign(adminKeypair);
        console.log(`   ⏱️  Transaction build time: ${Date.now() - startTxBuild}ms`);

        const startTxSend = Date.now();
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });
        console.log(`   ⏱️  Transaction send time: ${Date.now() - startTxSend}ms`);

        console.log(`   📝 Transaction Signature: ${signature}`);
        console.log('   ⏳ Waiting for confirmation...');

        // Wait for confirmation
        const startConfirm = Date.now();
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
        }, 'confirmed');
        console.log(`   ⏱️  Confirmation time: ${Date.now() - startConfirm}ms`);

        console.log('\n✅ Step 7: Transaction confirmed!');
        console.log(`   🔗 Explorer: https://explorer.solana.com/tx/${signature}?cluster=mainnet`);

        // Wait a bit and verify the update
        console.log('\n🔍 Step 8: Verifying predictions were cleared...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const startVerify = Date.now();
        const updatedAccount = await connection.getAccountInfo(userPredictionsPda);
        console.log(`   ⏱️  Verification fetch time: ${Date.now() - startVerify}ms`);
        
        if (updatedAccount) {
            const updatedData = updatedAccount.data;
            let verifyOffset = 40;

            // Read updated predictions
            const updatedTopPerformer: string[] = [];
            for (let i = 0; i < 5; i++) {
                updatedTopPerformer.push(parseFixedString(updatedData.slice(verifyOffset, verifyOffset + 6)));
                verifyOffset += 6;
            }

            const updatedWorstPerformer: string[] = [];
            for (let i = 0; i < 5; i++) {
                updatedWorstPerformer.push(parseFixedString(updatedData.slice(verifyOffset, verifyOffset + 6)));
                verifyOffset += 6;
            }

            // Skip timestamps
            verifyOffset += 80;

            // Read points
            const updatedPoints = updatedData.readBigUInt64LE(verifyOffset);

            console.log('\n' + '='.repeat(60));
            console.log(`🧹 Clear Predictions Summary:`);
            console.log('='.repeat(60));
            console.log(`   Points (PRESERVED): ${updatedPoints.toString()}`);
            console.log(`   Top Performers: [${updatedTopPerformer.map(s => s || '(empty)').join(', ')}]`);
            console.log(`   Worst Performers: [${updatedWorstPerformer.map(s => s || '(empty)').join(', ')}]`);
            console.log('='.repeat(60));
            
            const nowAllEmpty = updatedTopPerformer.every(s => !s || s.trim() === '') && 
                               updatedWorstPerformer.every(s => !s || s.trim() === '');
            
            const pointsMatch = updatedPoints.toString() === currentPoints.toString();
            
            if (nowAllEmpty && pointsMatch) {
                console.log('\n🎉 Success! Predictions cleared and points preserved!');
                console.log(`   ✅ All predictions cleared`);
                console.log(`   ✅ Points preserved: ${updatedPoints.toString()}`);
            } else {
                console.log('\n⚠️  Warning: Verification issues detected.');
                if (!nowAllEmpty) {
                    console.log(`   ❌ Some predictions may not be cleared`);
                }
                if (!pointsMatch) {
                    console.log(`   ❌ Points changed: ${currentPoints.toString()} → ${updatedPoints.toString()}`);
                }
            }
        } else {
            console.log('   ⚠️  Could not fetch updated account for verification');
        }

    } catch (error: any) {
        console.error('\n❌ Clear predictions failed!');
        if (error.logs) {
            console.error('\n📋 Program Logs:');
            error.logs.forEach((log: string) => console.error(log));
        }
        console.error('\n💥 Error:', error.message || error);
        console.error('\n💡 Troubleshooting:');
        console.error('1. Make sure SALT is set in your .env file');
        console.error('2. Verify the admin keypair is correctly stored in the database');
        console.error('3. Check that the user account exists on-chain');
        console.error('4. Ensure you have sufficient SOL for transaction fees');
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

clearUserPredictions();

