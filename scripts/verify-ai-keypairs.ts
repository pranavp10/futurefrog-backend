#!/usr/bin/env bun
/**
 * Script to verify all AI keypairs can be decrypted and accessed
 * 
 * Usage:
 * bun run scripts/verify-ai-keypairs.ts
 */

import 'dotenv/config';
import { 
    AI_KEYPAIR_NAMES, 
    getAIKeypair, 
    getAIPublicKey,
    verifyAllAIKeypairs 
} from '../src/lib/ai-keypairs-utils';

async function verifyAIKeypairs() {
    try {
        console.log('🔍 Verifying AI keypairs...\n');

        // Check SALT
        const salt = process.env.SALT;
        if (!salt) {
            console.error('❌ SALT environment variable is not set');
            process.exit(1);
        }
        console.log('✅ SALT environment variable is set\n');

        // Verify each keypair
        const results = await verifyAllAIKeypairs();
        
        let allPassed = true;
        for (const name of AI_KEYPAIR_NAMES) {
            if (results[name]) {
                const publicKey = await getAIPublicKey(name);
                console.log(`✅ ${name}`);
                console.log(`   Public Key: ${publicKey}\n`);
            } else {
                console.log(`❌ ${name} - Failed to decrypt\n`);
                allPassed = false;
            }
        }

        if (allPassed) {
            console.log('🎉 All AI keypairs verified successfully!');
        } else {
            console.log('⚠️ Some keypairs failed verification');
            console.log('Run: bun run scripts/generate-ai-keypairs.ts to regenerate');
        }

    } catch (error) {
        console.error('❌ Error verifying AI keypairs:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
verifyAIKeypairs();

