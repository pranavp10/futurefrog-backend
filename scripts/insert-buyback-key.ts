#!/usr/bin/env bun
/**
 * Script to insert the encrypted buy_back_key_v2 into the global_params table
 * 
 * Usage:
 * bun run scripts/insert-buyback-key.ts
 */

import 'dotenv/config';
import { db } from '../src/db';
import { globalParams } from '../src/db/schema/global_params';
import { eq } from 'drizzle-orm';

const PARAM_TITLE = 'buy_back_key_v2';
const ENCRYPTED_KEY = 'd68f7dc194ae339b3460541e0a71cb19eb499c53b0be2db41e913a03783f33b16a3b2fe11f7e2a0ea3b62ccbdde63e76d3f7720074e9e9546f97883aa1d6e9b3fd709b8545f9714258a418d1c2e1c0beebf4cd288ccd7b7aefb8498f966d43b3e5c012b87de4bbd32884996ba4a484ff3b296fac6784e8d349886eb119f1ef2de59a886ab50f1596b273053dc5f6734f4bcc0a7851b14ac87c86641b28d0fa340e01cc513062fb1d7913af0ce1bbf03c352e6d2cba5861e81042c8a846b0adaecbe8f3d7a294721a6d854ecede9ff42361a5f43203f17cc302f2e487524b16fe1d38577ded4681bdb6c840c71eda7a24da5f7a5732f68211cc7eb688bdda2544';

async function insertBuyBackKey() {
    try {
        console.log('🔑 Inserting encrypted buy_back_key_v2 into global_params...');

        // Check if the param already exists
        const existingParam = await db
            .select()
            .from(globalParams)
            .where(eq(globalParams.paramTitle, PARAM_TITLE))
            .limit(1);

        if (existingParam.length > 0) {
            // Update existing param
            console.log('📝 Updating existing buy_back_key_v2...');
            await db
                .update(globalParams)
                .set({
                    paramValue: ENCRYPTED_KEY,
                    updatedAt: new Date()
                })
                .where(eq(globalParams.paramTitle, PARAM_TITLE));
            console.log('✅ Updated existing buy_back_key_v2 in global_params');
        } else {
            // Insert new param
            console.log('📝 Inserting new buy_back_key_v2...');
            await db
                .insert(globalParams)
                .values({
                    paramTitle: PARAM_TITLE,
                    paramValue: ENCRYPTED_KEY,
                });
            console.log('✅ Inserted new buy_back_key_v2 into global_params');
        }

        console.log(`🔑 Param Title: ${PARAM_TITLE}`);
        console.log('🔐 Encrypted keypair stored securely');
        console.log('\n📖 Usage Notes:');
        console.log('• The key is encrypted using AES-256-CBC encryption');
        console.log('• Decryption requires the SALT environment variable');
        console.log('• Use getBuyBackKeypair() utility function to decrypt and use the key');

    } catch (error) {
        console.error('❌ Error inserting buy_back_key_v2:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
insertBuyBackKey();

