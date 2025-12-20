import { Elysia } from 'elysia';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getBuyBackKeypair, getBuyBackPublicKey } from '../lib/buyback-utils';

interface WalletInfo {
    publicKey: string;
    balance: number;
    balanceSOL: string;
    timestamp: string;
}

/**
 * Buyback wallet routes
 * Provides information about the buyback wallet (balance, public key, etc.)
 */
export const buybackWalletRoutes = new Elysia({ prefix: '/api/buyback-wallet' })
    .get('/info', async ({ set }) => {
        try {
            // Get RPC URL from environment
            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                throw new Error('SOLANA_RPC_URL not configured');
            }

            // Get the public key (this decrypts the keypair but only returns public key)
            const publicKey = await getBuyBackPublicKey();

            // Create connection and fetch balance
            const connection = new Connection(rpcUrl, 'confirmed');
            const keypair = await getBuyBackKeypair();
            const balance = await connection.getBalance(keypair.publicKey);

            const walletInfo: WalletInfo = {
                publicKey,
                balance,
                balanceSOL: (balance / LAMPORTS_PER_SOL).toFixed(9),
                timestamp: new Date().toISOString(),
            };

            return {
                success: true,
                data: walletInfo,
            };
        } catch (error) {
            console.error('Error fetching buyback wallet info:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch wallet info',
            };
        }
    })
    .get('/balance', async ({ set }) => {
        try {
            // Get RPC URL from environment
            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                throw new Error('SOLANA_RPC_URL not configured');
            }

            // Get the keypair and fetch balance
            const keypair = await getBuyBackKeypair();
            const connection = new Connection(rpcUrl, 'confirmed');
            const balance = await connection.getBalance(keypair.publicKey);

            return {
                success: true,
                data: {
                    balance,
                    balanceSOL: (balance / LAMPORTS_PER_SOL).toFixed(9),
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Error fetching buyback wallet balance:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch balance',
            };
        }
    })
    .get('/public-key', async ({ set }) => {
        try {
            const publicKey = await getBuyBackPublicKey();
            
            return {
                success: true,
                data: {
                    publicKey,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Error fetching buyback wallet public key:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch public key',
            };
        }
    });







