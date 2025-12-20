#!/usr/bin/env bun
/**
 * Script to update a user's points using the admin keypair
 * 
 * This script:
 * 1. Reads the admin keypair from the global_params table (encrypted)
 * 2. Decrypts the keypair using the SALT environment variable
 * 3. Reads the current points for the user
 * 4. Adds the specified amount to the current points
 * 5. Calls the update_user_points instruction on the Solana program
 * 
 * Usage:
 *   bun run scripts/update-user-points.ts <user_address> <points_to_add>
 * 
 * Example:
 *   bun run scripts/update-user-points.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM 1000
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
const UPDATE_USER_POINTS_IX = Buffer.from([0x40, 0x04, 0xb8, 0x7e, 0x00, 0x2e, 0xc4, 0x9f]);
const EXPECTED_ADMIN = new PublicKey('J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo');

async function updateUserPoints() {
    try {
        const args = process.argv.slice(2);

        if (args.length < 2) {
            console.error('❌ Error: Please provide user address and points to add');
            console.error('\nUsage: bun run scripts/update-user-points.ts <user_address> <points_to_add>');
            console.error('Example: bun run scripts/update-user-points.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM 1000');
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

        // Parse points to add
        const pointsToAdd = parseInt(args[1]);
        if (isNaN(pointsToAdd)) {
            console.error('❌ Error: Invalid points value. Must be an integer.');
            process.exit(1);
        }

        console.log('=' .repeat(60));
        console.log('🎯 Update User Points (Add Points)');
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
        console.log(`   Points to Add: ${pointsToAdd > 0 ? '+' : ''}${pointsToAdd}`);

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

        // Read current points
        const currentPoints = userAccount.data.readBigUInt64LE(8 + 32 + 140);
        console.log(`   📊 Current Points: ${currentPoints.toString()}`);

        // Calculate new points
        const newPoints = Number(currentPoints) + pointsToAdd;
        if (newPoints < 0) {
            console.error(`   ❌ Error: Cannot set negative points!`);
            console.error(`   Current: ${currentPoints}, To Add: ${pointsToAdd}, Result: ${newPoints}`);
            process.exit(1);
        }
        console.log(`   🎯 New Points After Addition: ${newPoints}`);
        console.log(`   📈 Change: ${currentPoints} ${pointsToAdd >= 0 ? '+' : ''} ${pointsToAdd} = ${newPoints}`);

        // Create instruction
        console.log('\n🔨 Step 5: Building transaction...');
        const pointsBuffer = Buffer.alloc(8);
        pointsBuffer.writeBigUInt64LE(BigInt(newPoints));
        const instructionData = Buffer.concat([UPDATE_USER_POINTS_IX, pointsBuffer]);
        console.log(`   📝 Instruction discriminator: ${UPDATE_USER_POINTS_IX.toString('hex')}`);
        console.log(`   📝 Points data (hex): ${pointsBuffer.toString('hex')}`);

        const instruction = new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: userPredictionsPda, isSigner: false, isWritable: true },
                { pubkey: globalStatePda, isSigner: false, isWritable: false },
                { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
            ],
            data: instructionData,
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
        console.log('\n🔍 Step 8: Verifying points update...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const startVerify = Date.now();
        const updatedAccount = await connection.getAccountInfo(userPredictionsPda);
        console.log(`   ⏱️  Verification fetch time: ${Date.now() - startVerify}ms`);
        
        if (updatedAccount) {
            const updatedPoints = updatedAccount.data.readBigUInt64LE(8 + 32 + 140);
            console.log('\n' + '='.repeat(60));
            console.log(`🎯 Points Update Summary:`);
            console.log(`   Before: ${currentPoints}`);
            console.log(`   Change: ${pointsToAdd >= 0 ? '+' : ''}${pointsToAdd}`);
            console.log(`   After:  ${updatedPoints}`);
            console.log(`   Expected: ${newPoints}`);
            console.log('='.repeat(60));
            
            if (updatedPoints.toString() === newPoints.toString()) {
                console.log('\n🎉 Success! Points updated correctly!');
                console.log(`   ✅ Verification passed: ${updatedPoints} === ${newPoints}`);
            } else {
                console.log('\n⚠️  Warning: Points may not have updated as expected.');
                console.log(`   ❌ Verification failed: ${updatedPoints} !== ${newPoints}`);
            }
        } else {
            console.log('   ⚠️  Could not fetch updated account for verification');
        }

    } catch (error: any) {
        console.error('\n❌ Update failed!');
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

updateUserPoints();

