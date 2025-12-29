#!/usr/bin/env bun
/**
 * Script to generate 5 AI keypairs, encrypt them using SALT, and insert into global_params table
 * 
 * AI Keypairs:
 * - gpt-5.2
 * - claude-opus-4-5-20251101
 * - gemini-3-pro-preview
 * - grok-4
 * - deepseek-reasoner
 * 
 * Usage:
 * bun run scripts/generate-ai-keypairs.ts
 */

import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import { createHash, createCipheriv } from 'node:crypto';
import { db } from '../src/db';
import { globalParams } from '../src/db/schema/global_params';
import { eq } from 'drizzle-orm';

const AI_KEYPAIR_NAMES = [
    'gpt-5.2',
    'claude-opus-4-5-20251101',
    'gemini-3-pro-preview',
    'grok-4',
    'deepseek-reasoner'
] as const;

/**
 * Encrypts data using AES-256-CBC with SALT-based key derivation
 */
function encryptDataV2(data: string, salt: string): string {
    const key = createHash('sha256').update(salt).digest();
    const iv = Buffer.alloc(16, 0); // Fixed IV (same as used in buyback key)

    const cipher = createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

async function generateAndInsertAIKeypairs() {
    try {
        const salt = process.env.SALT;
        if (!salt) {
            console.error('❌ SALT environment variable is required but not set');
            process.exit(1);
        }

        console.log('🔑 Generating 5 AI keypairs...\n');

        for (const name of AI_KEYPAIR_NAMES) {
            const paramTitle = `ai_keypair_${name}`;
            
            // Generate a new Solana keypair
            const keypair = Keypair.generate();
            const publicKey = keypair.publicKey.toBase58();
            const secretKeyJson = JSON.stringify(Array.from(keypair.secretKey));
            
            // Encrypt the secret key
            const encryptedKey = encryptDataV2(secretKeyJson, salt);

            // Check if the param already exists
            const existingParam = await db
                .select()
                .from(globalParams)
                .where(eq(globalParams.paramTitle, paramTitle))
                .limit(1);

            if (existingParam.length > 0) {
                // Update existing param
                await db
                    .update(globalParams)
                    .set({
                        paramValue: encryptedKey,
                        updatedAt: new Date()
                    })
                    .where(eq(globalParams.paramTitle, paramTitle));
                console.log(`📝 Updated: ${name}`);
            } else {
                // Insert new param
                await db
                    .insert(globalParams)
                    .values({
                        paramTitle: paramTitle,
                        paramValue: encryptedKey,
                    });
                console.log(`✅ Created: ${name}`);
            }

            console.log(`   Public Key: ${publicKey}`);
            console.log(`   Param Title: ${paramTitle}\n`);
        }

        console.log('🎉 All 5 AI keypairs generated and stored successfully!');
        console.log('\n📖 Usage Notes:');
        console.log('• Keys are encrypted using AES-256-CBC with SALT');
        console.log('• Use getAIKeypair(name) to retrieve a specific keypair');
        console.log('• Use getAIPublicKey(name) to get just the public key');
        console.log('• Available names: gpt-5.2, claude-opus-4-5-20251101, gemini-3-pro-preview, grok-4, deepseek-reasoner');

    } catch (error) {
        console.error('❌ Error generating AI keypairs:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
generateAndInsertAIKeypairs();

