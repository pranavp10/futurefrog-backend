/**
 * Utility functions for retrieving and decrypting the buyback keypair
 * from encrypted storage in the global_params table.
 * 
 * This follows the same encryption pattern as klout-backend-v3.
 */

import { Keypair } from '@solana/web3.js';
import { createHash, createDecipheriv } from 'node:crypto';
import { db } from '../db';
import { globalParams } from '../db/schema/global_params';
import { eq } from 'drizzle-orm';

const PARAM_TITLE = 'buy_back_key_v2';

/**
 * Decrypts data using AES-256-CBC with SALT-based key derivation
 */
function decryptDataV2(encryptedData: string, salt: string): string {
    // Modern AES-256-CBC decryption with proper IV
    const key = createHash('sha256').update(salt).digest();
    const iv = Buffer.alloc(16, 0); // Fixed IV (same as used in klout-backend)

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
 * Retrieves and decrypts the buyback keypair from the database.
 * 
 * @returns {Promise<Keypair>} The decrypted Solana keypair
 * @throws {Error} If SALT is not set, keypair not found, or decryption fails
 */
export async function getBuyBackKeypair(): Promise<Keypair> {
    try {
        // Check if SALT environment variable is set
        const salt = process.env.SALT;
        if (!salt) {
            throw new Error('SALT environment variable is required but not set');
        }

        // Retrieve the encrypted keypair from database
        const paramResult = await db
            .select()
            .from(globalParams)
            .where(eq(globalParams.paramTitle, PARAM_TITLE))
            .limit(1);

        if (paramResult.length === 0) {
            throw new Error(
                `No encrypted buy_back_key_v2 found with param_title: ${PARAM_TITLE}. ` +
                'Please run: bun run scripts/insert-buyback-key.ts'
            );
        }

        // Decrypt the keypair
        const encryptedKeypair = paramResult[0].paramValue;
        const decryptedJson = decryptDataV2(encryptedKeypair, salt);
        const secretKeyArray = JSON.parse(decryptedJson);

        // Create and return the Keypair
        return Keypair.fromSecretKey(new Uint8Array(secretKeyArray));

    } catch (error) {
        throw new Error(`Failed to retrieve/decrypt buyback keypair: ${error}`);
    }
}

/**
 * Retrieves the buyback public key without needing to decrypt the full keypair.
 * Note: Currently, this still requires decryption. In the future, we could store
 * the public key separately for faster access.
 * 
 * @returns {Promise<string>} The public key as a base58 string
 */
export async function getBuyBackPublicKey(): Promise<string> {
    const keypair = await getBuyBackKeypair();
    return keypair.publicKey.toBase58();
}

/**
 * Verifies that the buyback keypair can be successfully decrypted.
 * Useful for testing and validation.
 * 
 * @returns {Promise<boolean>} True if keypair can be decrypted, false otherwise
 */
export async function verifyBuyBackKeypair(): Promise<boolean> {
    try {
        const keypair = await getBuyBackKeypair();
        return keypair !== null && keypair.publicKey !== null;
    } catch (error) {
        console.error('Buyback keypair verification failed:', error);
        return false;
    }
}



