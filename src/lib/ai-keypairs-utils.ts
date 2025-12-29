/**
 * Utility functions for retrieving and decrypting AI keypairs
 * from encrypted storage in the global_params table.
 * 
 * Available AI Keypairs:
 * - gpt-5.2
 * - claude-opus-4-5-20251101
 * - gemini-3-pro-preview
 * - grok-4
 * - deepseek-reasoner
 */

import { Keypair } from '@solana/web3.js';
import { createHash, createDecipheriv } from 'node:crypto';
import { db } from '../db';
import { globalParams } from '../db/schema/global_params';
import { eq } from 'drizzle-orm';

export const AI_KEYPAIR_NAMES = [
    'gpt-5.2',
    'claude-opus-4-5-20251101',
    'gemini-3-pro-preview',
    'grok-4',
    'deepseek-reasoner'
] as const;

export type AIKeypairName = typeof AI_KEYPAIR_NAMES[number];

/**
 * Decrypts data using AES-256-CBC with SALT-based key derivation
 */
function decryptDataV2(encryptedData: string, salt: string): string {
    const key = createHash('sha256').update(salt).digest();
    const iv = Buffer.alloc(16, 0);

    try {
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        throw new Error(`Decryption failed: ${error}`);
    }
}

/**
 * Retrieves and decrypts an AI keypair from the database.
 * 
 * @param name - The AI keypair name (e.g., 'gpt-5.2', 'claude-opus-4-5-20251101')
 * @returns {Promise<Keypair>} The decrypted Solana keypair
 * @throws {Error} If SALT is not set, keypair not found, or decryption fails
 */
export async function getAIKeypair(name: AIKeypairName): Promise<Keypair> {
    try {
        const salt = process.env.SALT;
        if (!salt) {
            throw new Error('SALT environment variable is required but not set');
        }

        const paramTitle = `ai_keypair_${name}`;

        const paramResult = await db
            .select()
            .from(globalParams)
            .where(eq(globalParams.paramTitle, paramTitle))
            .limit(1);

        if (paramResult.length === 0) {
            throw new Error(
                `No encrypted AI keypair found with param_title: ${paramTitle}. ` +
                'Please run: bun run scripts/generate-ai-keypairs.ts'
            );
        }

        const encryptedKeypair = paramResult[0].paramValue;
        const decryptedJson = decryptDataV2(encryptedKeypair, salt);
        const secretKeyArray = JSON.parse(decryptedJson);

        return Keypair.fromSecretKey(new Uint8Array(secretKeyArray));

    } catch (error) {
        throw new Error(`Failed to retrieve/decrypt AI keypair '${name}': ${error}`);
    }
}

/**
 * Retrieves the public key for an AI keypair.
 * 
 * @param name - The AI keypair name
 * @returns {Promise<string>} The public key as a base58 string
 */
export async function getAIPublicKey(name: AIKeypairName): Promise<string> {
    const keypair = await getAIKeypair(name);
    return keypair.publicKey.toBase58();
}

/**
 * Retrieves all AI keypairs.
 * 
 * @returns {Promise<Record<AIKeypairName, Keypair>>} Object mapping names to keypairs
 */
export async function getAllAIKeypairs(): Promise<Record<AIKeypairName, Keypair>> {
    const result = {} as Record<AIKeypairName, Keypair>;
    
    for (const name of AI_KEYPAIR_NAMES) {
        result[name] = await getAIKeypair(name);
    }
    
    return result;
}

/**
 * Retrieves all AI public keys.
 * 
 * @returns {Promise<Record<AIKeypairName, string>>} Object mapping names to public keys
 */
export async function getAllAIPublicKeys(): Promise<Record<AIKeypairName, string>> {
    const result = {} as Record<AIKeypairName, string>;
    
    for (const name of AI_KEYPAIR_NAMES) {
        result[name] = await getAIPublicKey(name);
    }
    
    return result;
}

/**
 * Verifies that an AI keypair can be successfully decrypted.
 * 
 * @param name - The AI keypair name
 * @returns {Promise<boolean>} True if keypair can be decrypted
 */
export async function verifyAIKeypair(name: AIKeypairName): Promise<boolean> {
    try {
        const keypair = await getAIKeypair(name);
        return keypair !== null && keypair.publicKey !== null;
    } catch (error) {
        console.error(`AI keypair '${name}' verification failed:`, error);
        return false;
    }
}

/**
 * Verifies all AI keypairs can be successfully decrypted.
 * 
 * @returns {Promise<Record<AIKeypairName, boolean>>} Object mapping names to verification status
 */
export async function verifyAllAIKeypairs(): Promise<Record<AIKeypairName, boolean>> {
    const result = {} as Record<AIKeypairName, boolean>;
    
    for (const name of AI_KEYPAIR_NAMES) {
        result[name] = await verifyAIKeypair(name);
    }
    
    return result;
}

