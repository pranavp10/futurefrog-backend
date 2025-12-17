#!/usr/bin/env bun
/**
 * Script to verify that the buyback keypair is correctly encrypted and stored
 * in the global_params table, and can be successfully decrypted.
 * 
 * Usage:
 * bun run scripts/verify-buyback-key.ts
 */

import 'dotenv/config';
import { getBuyBackKeypair, getBuyBackPublicKey, verifyBuyBackKeypair } from '../src/lib/buyback-utils';

async function verifyBuybackKeyEncrypted() {
    try {
        console.log('🔍 Verifying Buyback Encrypted Key Storage...\n');

        // Check for SALT
        const salt = process.env.SALT;
        if (!salt) {
            throw new Error('SALT environment variable is required but not set');
        }
        console.log('✅ SALT environment variable found');

        // Try to retrieve and decrypt the keypair
        console.log('🔓 Attempting to retrieve and decrypt buyback keypair...');
        const keypair = await getBuyBackKeypair();
        console.log('✅ Successfully retrieved and decrypted keypair');

        // Get public key
        const publicKey = keypair.publicKey.toBase58();
        console.log(`📍 Public Key: ${publicKey}`);

        // Verify using utility function
        console.log('\n🔍 Running verification check...');
        const isValid = await verifyBuyBackKeypair();
        if (!isValid) {
            throw new Error('Keypair verification failed');
        }
        console.log('✅ Keypair verification passed');

        // Test the getBuyBackPublicKey utility
        console.log('\n🔍 Testing getBuyBackPublicKey utility...');
        const pubKeyFromUtil = await getBuyBackPublicKey();
        if (pubKeyFromUtil !== publicKey) {
            throw new Error('Public key mismatch');
        }
        console.log(`✅ Public key utility works: ${pubKeyFromUtil}`);

        // Summary
        console.log('\n✅ All checks passed!');
        console.log('\n📋 Summary:');
        console.log('• Buyback keypair is correctly encrypted and stored');
        console.log('• Decryption works properly');
        console.log('• All utility functions are working');
        console.log(`• Public Key: ${publicKey}`);

        console.log('\n🎉 Your buyback key encryption is working perfectly!');

    } catch (error) {
        console.error('\n❌ Verification failed:', error);
        console.error('\n💡 Troubleshooting:');
        console.error('1. Make sure you have run: bun run scripts/insert-buyback-key.ts');
        console.error('2. Verify that SALT environment variable is set correctly');
        console.error('3. Check that the encryption was successful in the database');
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

verifyBuybackKeyEncrypted();

