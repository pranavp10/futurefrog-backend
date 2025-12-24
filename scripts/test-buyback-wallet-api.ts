#!/usr/bin/env bun
/**
 * Test script to verify buyback wallet API functionality
 */

import 'dotenv/config';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getBuyBackKeypair, getBuyBackPublicKey } from '../src/lib/buyback-utils';

async function testBuybackWallet() {
    try {
        console.log('🔍 Testing Buyback Wallet API Functionality\n');

        // Test 1: Get Public Key
        console.log('1️⃣ Getting public key...');
        const publicKey = await getBuyBackPublicKey();
        console.log(`   ✅ Public Key: ${publicKey}\n`);

        // Test 2: Get Full Keypair
        console.log('2️⃣ Getting full keypair...');
        const keypair = await getBuyBackKeypair();
        console.log(`   ✅ Keypair loaded successfully`);
        console.log(`   Public Key: ${keypair.publicKey.toBase58()}\n`);

        // Test 3: Check RPC URL
        const rpcUrl = process.env.SOLANA_RPC_URL;
        console.log('3️⃣ Checking RPC configuration...');
        console.log(`   RPC URL: ${rpcUrl}\n`);

        if (!rpcUrl) {
            throw new Error('SOLANA_RPC_URL not set in environment');
        }

        // Test 4: Fetch Balance
        console.log('4️⃣ Fetching wallet balance from Solana...');
        const connection = new Connection(rpcUrl, 'confirmed');
        const balance = await connection.getBalance(keypair.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;
        
        console.log(`   ✅ Balance: ${balance} lamports`);
        console.log(`   ✅ Balance: ${balanceSOL.toFixed(9)} SOL\n`);

        // Summary
        console.log('✅ All tests passed!');
        console.log('\n📋 Summary:');
        console.log(`   Public Key: ${publicKey}`);
        console.log(`   Balance: ${balanceSOL.toFixed(9)} SOL`);
        console.log(`   RPC: ${rpcUrl}`);

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('\n💡 Troubleshooting:');
        console.error('1. Verify SALT is set in .env');
        console.error('2. Verify SOLANA_RPC_URL is set correctly');
        console.error('3. Check that the buyback key is in the database');
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

testBuybackWallet();








