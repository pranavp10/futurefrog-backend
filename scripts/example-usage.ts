#!/usr/bin/env bun
/**
 * Example script showing how to use the buyback keypair utilities
 * 
 * Usage:
 * bun run scripts/example-usage.ts
 */

import 'dotenv/config';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getBuyBackKeypair, getBuyBackPublicKey } from '../src/lib/buyback-utils';

async function exampleUsage() {
    try {
        console.log('📖 Example: Using the Buyback Keypair\n');

        // Example 1: Get just the public key (faster, doesn't need full decryption)
        console.log('1️⃣ Getting public key...');
        const publicKey = await getBuyBackPublicKey();
        console.log(`   Public Key: ${publicKey}\n`);

        // Example 2: Get the full keypair (needed for signing transactions)
        console.log('2️⃣ Getting full keypair...');
        const keypair = await getBuyBackKeypair();
        console.log(`   Public Key: ${keypair.publicKey.toBase58()}`);
        console.log(`   Has Secret Key: ${keypair.secretKey ? 'Yes' : 'No'}\n`);

        // Example 3: Check wallet balance on Solana (requires RPC connection)
        console.log('3️⃣ Checking wallet balance on Solana...');
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const balance = await connection.getBalance(keypair.publicKey);
        console.log(`   Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

        console.log('✅ Example completed successfully!');
        console.log('\n💡 Usage Tips:');
        console.log('• Use getBuyBackPublicKey() when you only need the address');
        console.log('• Use getBuyBackKeypair() when you need to sign transactions');
        console.log('• Always keep your SALT environment variable secure');
        console.log('• The keypair is decrypted fresh each time (no caching)');

    } catch (error) {
        console.error('\n❌ Example failed:', error);
        console.error('\n💡 Make sure:');
        console.error('1. SALT is set in your .env file');
        console.error('2. The encrypted key is in the database');
        console.error('3. You have network access to check Solana balance');
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

exampleUsage();






