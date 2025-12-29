#!/usr/bin/env bun
/**
 * Script to send 0.1 SOL to each AI wallet from the local Solana wallet
 * 
 * Usage:
 * bun run scripts/fund-ai-wallets.ts
 */

import 'dotenv/config';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AI_KEYPAIR_NAMES, getAIPublicKey } from '../src/lib/ai-keypairs-utils';

const AMOUNT_SOL = 0.1;
const AMOUNT_LAMPORTS = AMOUNT_SOL * LAMPORTS_PER_SOL;

async function fundAIWallets() {
    try {
        // Get RPC URL
        const rpcUrl = process.env.SOLANA_RPC_URL;
        if (!rpcUrl) {
            console.error('❌ SOLANA_RPC_URL environment variable is required');
            process.exit(1);
        }

        // Load local wallet keypair
        const keypairPath = join(homedir(), '.config', 'solana', 'id.json');
        console.log(`📂 Loading wallet from: ${keypairPath}`);
        
        const keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'));
        const senderKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
        const senderPubkey = senderKeypair.publicKey;
        
        console.log(`💳 Sender wallet: ${senderPubkey.toBase58()}`);

        // Create connection
        const connection = new Connection(rpcUrl, 'confirmed');
        
        // Check sender balance
        const senderBalance = await connection.getBalance(senderPubkey);
        const requiredBalance = AMOUNT_LAMPORTS * AI_KEYPAIR_NAMES.length + 10000; // Extra for fees
        
        console.log(`💰 Sender balance: ${(senderBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        console.log(`📊 Required: ~${((requiredBalance) / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

        if (senderBalance < requiredBalance) {
            console.error('❌ Insufficient balance to fund all wallets');
            process.exit(1);
        }

        console.log(`🚀 Sending ${AMOUNT_SOL} SOL to each AI wallet...\n`);

        for (const name of AI_KEYPAIR_NAMES) {
            try {
                const publicKeyStr = await getAIPublicKey(name);
                const recipientPubkey = new PublicKey(publicKeyStr);

                // Check current balance
                const currentBalance = await connection.getBalance(recipientPubkey);
                console.log(`📍 ${name}`);
                console.log(`   Address: ${publicKeyStr}`);
                console.log(`   Current balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

                // Create transfer transaction
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: senderPubkey,
                        toPubkey: recipientPubkey,
                        lamports: AMOUNT_LAMPORTS,
                    })
                );

                // Send and confirm transaction
                const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);
                
                // Check new balance
                const newBalance = await connection.getBalance(recipientPubkey);
                console.log(`   ✅ Sent ${AMOUNT_SOL} SOL`);
                console.log(`   New balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
                console.log(`   Tx: ${signature}\n`);

            } catch (err) {
                console.error(`   ❌ Failed to send to ${name}:`, err);
            }
        }

        console.log('🎉 Funding complete!');

    } catch (error) {
        console.error('❌ Error funding AI wallets:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
fundAIWallets();

