import { Elysia, t } from 'elysia';
import { db } from '../db';
import { userBets } from '../db/schema';
import { eq, sql, and, desc } from 'drizzle-orm';

const DFLOW_METADATA_API = 'https://b.prediction-markets-api.dflow.net';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CASH_MINT = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';

interface HeliusTransaction {
    signature: string;
    timestamp: number;
    type: string;
    tokenTransfers?: Array<{
        mint: string;
        tokenAmount: number;
        fromUserAccount?: string;
        toUserAccount?: string;
    }>;
    accountData?: Array<{
        tokenBalanceChanges?: Array<{
            mint: string;
            rawTokenAmount?: {
                tokenAmount: string;
                decimals: number;
            };
        }>;
    }>;
}

/**
 * Fetch and reconcile user trades from Helius
 * This ensures our DB stays in sync with on-chain state
 */
async function reconcileUserBets(publicKey: string): Promise<void> {
    let heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
        const rpcUrl = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC_ENDPOINT;
        if (rpcUrl) {
            const match = rpcUrl.match(/api-key=([a-f0-9-]+)/);
            heliusApiKey = match?.[1];
        }
    }
    
    if (!heliusApiKey) {
        console.log('[Reconcile] No Helius API key, skipping reconciliation');
        return;
    }

    try {
        // Get pending bets from DB
        const pendingBets = await db
            .select()
            .from(userBets)
            .where(and(
                eq(userBets.publicKey, publicKey),
                eq(userBets.status, 'pending')
            ));

        if (pendingBets.length === 0) {
            return;
        }

        console.log(`[Reconcile] Found ${pendingBets.length} pending bets for ${publicKey.slice(0, 8)}...`);

        // Check each pending bet's transaction status
        const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
        
        for (const bet of pendingBets) {
            try {
                const response = await fetch(heliusUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'getTransaction',
                        params: [bet.txSignature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
                    })
                });

                const result = await response.json();
                
                if (result.result) {
                    // Transaction found and confirmed
                    console.log(`[Reconcile] Confirming bet ${bet.txSignature.slice(0, 8)}...`);
                    await db
                        .update(userBets)
                        .set({ 
                            status: 'confirmed',
                            confirmedAt: new Date()
                        })
                        .where(eq(userBets.id, bet.id));
                } else if (result.error) {
                    // Check if bet is old enough to mark as failed (older than 2 minutes)
                    const betAge = Date.now() - new Date(bet.createdAt).getTime();
                    if (betAge > 2 * 60 * 1000) {
                        console.log(`[Reconcile] Marking old bet as failed ${bet.txSignature.slice(0, 8)}...`);
                        await db
                            .update(userBets)
                            .set({ status: 'failed' })
                            .where(eq(userBets.id, bet.id));
                    }
                }
            } catch (err) {
                console.error(`[Reconcile] Error checking tx ${bet.txSignature}:`, err);
            }
        }
    } catch (err) {
        console.error('[Reconcile] Error:', err);
    }
}

/**
 * Backfill user bets from Helius transaction history
 * This catches trades that were made before tracking was added
 */
async function backfillUserBets(publicKey: string): Promise<number> {
    let heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
        const rpcUrl = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC_ENDPOINT;
        if (rpcUrl) {
            const match = rpcUrl.match(/api-key=([a-f0-9-]+)/);
            heliusApiKey = match?.[1];
        }
    }
    
    if (!heliusApiKey) {
        return 0;
    }

    const apiKey = process.env.DFLOW_API_KEY;
    
    try {
        // Fetch transaction history from Helius
        const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
        
        let allSignatures: Array<{ signature: string }> = [];
        let beforeSignature: string | undefined = undefined;
        const MAX_BATCHES = 5;
        
        for (let batch = 0; batch < MAX_BATCHES; batch++) {
            const sigResponse = await fetch(heliusUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getSignaturesForAddress',
                    params: [
                        publicKey,
                        { 
                            limit: 100,
                            ...(beforeSignature && { before: beforeSignature })
                        }
                    ]
                })
            });

            const signaturesResult = await sigResponse.json();
            const batchSignatures = signaturesResult.result || [];
            
            if (batchSignatures.length === 0) break;
            
            allSignatures = [...allSignatures, ...batchSignatures];
            beforeSignature = batchSignatures[batchSignatures.length - 1].signature;
            
            if (batchSignatures.length < 100) break;
        }

        if (allSignatures.length === 0) return 0;

        // Get existing tx signatures from DB
        const existingBets = await db
            .select({ txSignature: userBets.txSignature })
            .from(userBets)
            .where(eq(userBets.publicKey, publicKey));
        
        const existingSignatures = new Set(existingBets.map(b => b.txSignature));

        // Filter to signatures we haven't recorded
        const newSignatures = allSignatures.filter(s => !existingSignatures.has(s.signature));
        
        if (newSignatures.length === 0) return 0;

        // Parse transactions using Helius Enhanced API
        const parsedTxResponse = await fetch(
            `https://api.helius.xyz/v0/transactions?api-key=${heliusApiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactions: newSignatures.slice(0, 100).map(s => s.signature),
                }),
            }
        );

        if (!parsedTxResponse.ok) return 0;

        const parsedTransactions: HeliusTransaction[] = await parsedTxResponse.json();
        
        // Filter to PLACE_BET transactions
        const betTransactions = parsedTransactions.filter(tx => 
            tx && !('transactionError' in tx) && tx.type === 'PLACE_BET'
        );

        let backfilledCount = 0;

        for (const tx of betTransactions) {
            try {
                // Extract bet details from transaction
                const tokenTransfers = tx.tokenTransfers || [];
                const accountData = tx.accountData || [];
                
                // Find USDC/CASH spent
                let investedAmount = 0;
                for (const transfer of tokenTransfers) {
                    if (transfer.mint === USDC_MINT || transfer.mint === CASH_MINT) {
                        if (transfer.fromUserAccount) {
                            investedAmount = Math.abs(transfer.tokenAmount || 0);
                            break;
                        }
                    }
                }

                if (investedAmount === 0) continue;

                // Find outcome token received
                let outcomeMint: string | null = null;
                let contracts = 0;

                for (const account of accountData) {
                    if (account.tokenBalanceChanges) {
                        for (const change of account.tokenBalanceChanges) {
                            if (change.mint !== USDC_MINT && change.mint !== CASH_MINT) {
                                const decimals = change.rawTokenAmount?.decimals || 6;
                                const amount = parseInt(change.rawTokenAmount?.tokenAmount || '0') / Math.pow(10, decimals);
                                if (amount > 0) {
                                    outcomeMint = change.mint;
                                    contracts = amount;
                                    break;
                                }
                            }
                        }
                    }
                    if (outcomeMint) break;
                }

                if (!outcomeMint || contracts === 0) continue;

                // Try to get market details from DFlow
                let marketTicker = 'Unknown';
                let marketTitle = 'Unknown Market';
                let side: 'yes' | 'no' = 'yes';

                if (apiKey) {
                    try {
                        const marketResponse = await fetch(
                            `${DFLOW_METADATA_API}/api/v1/market/by-mint/${outcomeMint}`,
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-api-key': apiKey,
                                },
                            }
                        );

                        if (marketResponse.ok) {
                            const market = await marketResponse.json();
                            marketTicker = market.ticker || 'Unknown';
                            marketTitle = market.yesSubTitle || market.title || 'Unknown Market';
                            
                            // Determine if YES or NO token
                            for (const account of Object.values(market.accounts || {}) as Array<{ yesMint?: string; noMint?: string }>) {
                                if (account.yesMint === outcomeMint) {
                                    side = 'yes';
                                    break;
                                } else if (account.noMint === outcomeMint) {
                                    side = 'no';
                                    break;
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[Backfill] Error fetching market:', err);
                    }
                }

                const entryPrice = contracts > 0 ? investedAmount / contracts : 0;

                // Insert the bet
                await db.insert(userBets).values({
                    publicKey,
                    marketTicker,
                    marketTitle,
                    side,
                    contracts: contracts.toString(),
                    entryPrice: entryPrice.toString(),
                    investedAmount: investedAmount.toString(),
                    txSignature: tx.signature,
                    mint: outcomeMint,
                    status: 'confirmed',
                    confirmedAt: new Date(tx.timestamp * 1000),
                    createdAt: new Date(tx.timestamp * 1000),
                }).onConflictDoNothing();

                backfilledCount++;
            } catch (err) {
                console.error('[Backfill] Error processing tx:', err);
            }
        }

        console.log(`[Backfill] Added ${backfilledCount} historical bets for ${publicKey.slice(0, 8)}...`);
        return backfilledCount;
    } catch (err) {
        console.error('[Backfill] Error:', err);
        return 0;
    }
}

export const userBetsRoutes = new Elysia({ prefix: '/api/user-bets' })
    // Record a new bet (called after signing, before sending to chain)
    .post('/record', async ({ body, set }) => {
        try {
            const { publicKey, marketTicker, marketTitle, eventTitle, side, contracts, entryPrice, investedAmount, txSignature, mint } = body;

            // Insert with pending status
            const result = await db.insert(userBets).values({
                publicKey,
                marketTicker,
                marketTitle,
                eventTitle,
                side,
                contracts: contracts.toString(),
                entryPrice: entryPrice.toString(),
                investedAmount: investedAmount.toString(),
                txSignature,
                mint,
                status: 'pending',
            }).onConflictDoNothing().returning();

            return {
                success: true,
                bet: result[0] || null,
                message: result.length > 0 ? 'Bet recorded' : 'Bet already exists',
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error recording bet:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to record bet',
            };
        }
    }, {
        body: t.Object({
            publicKey: t.String(),
            marketTicker: t.String(),
            marketTitle: t.Optional(t.String()),
            eventTitle: t.Optional(t.String()),
            side: t.String(),
            contracts: t.Number(),
            entryPrice: t.Number(),
            investedAmount: t.Number(),
            txSignature: t.String(),
            mint: t.Optional(t.String()),
        })
    })

    // Confirm a bet (called after transaction confirms on chain)
    .patch('/confirm/:txSignature', async ({ params, set }) => {
        try {
            const result = await db
                .update(userBets)
                .set({ 
                    status: 'confirmed',
                    confirmedAt: new Date()
                })
                .where(eq(userBets.txSignature, params.txSignature))
                .returning();

            if (result.length === 0) {
                set.status = 404;
                return { success: false, error: 'Bet not found' };
            }

            return {
                success: true,
                bet: result[0],
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error confirming bet:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to confirm bet',
            };
        }
    })

    // Record a redemption
    .post('/redeem', async ({ body, set }) => {
        try {
            const { publicKey, marketTicker, redemptionAmount, txSignature, side } = body;

            // Find the matching bet
            const existingBets = await db
                .select()
                .from(userBets)
                .where(and(
                    eq(userBets.publicKey, publicKey),
                    eq(userBets.marketTicker, marketTicker),
                    eq(userBets.side, side)
                ))
                .orderBy(desc(userBets.createdAt))
                .limit(1);

            if (existingBets.length === 0) {
                // Create a new record if bet wasn't tracked
                await db.insert(userBets).values({
                    publicKey,
                    marketTicker,
                    side,
                    contracts: '0',
                    entryPrice: '0',
                    investedAmount: '0',
                    txSignature: `redeem-${txSignature}`,
                    status: 'redeemed',
                    redemptionAmount: redemptionAmount.toString(),
                    redemptionTxSignature: txSignature,
                    redeemedAt: new Date(),
                });

                return {
                    success: true,
                    message: 'Redemption recorded (new entry)',
                    timestamp: new Date().toISOString(),
                };
            }

            // Update existing bet
            const result = await db
                .update(userBets)
                .set({ 
                    status: 'redeemed',
                    redemptionAmount: redemptionAmount.toString(),
                    redemptionTxSignature: txSignature,
                    redeemedAt: new Date()
                })
                .where(eq(userBets.id, existingBets[0].id))
                .returning();

            return {
                success: true,
                bet: result[0],
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error recording redemption:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to record redemption',
            };
        }
    }, {
        body: t.Object({
            publicKey: t.String(),
            marketTicker: t.String(),
            side: t.String(),
            redemptionAmount: t.Number(),
            txSignature: t.String(),
        })
    })

    // Get user stats with reconciliation
    .get('/stats/:publicKey', async ({ params, query, set }) => {
        try {
            const { publicKey } = params;
            const shouldBackfill = query.backfill === 'true';

            // Run reconciliation to sync pending bets
            await reconcileUserBets(publicKey);

            // Optionally backfill from chain history
            let backfilledCount = 0;
            if (shouldBackfill) {
                backfilledCount = await backfillUserBets(publicKey);
            }

            // Calculate stats from confirmed/redeemed bets
            const statsResult = await db
                .select({
                    totalBets: sql<number>`count(*)::int`,
                    totalInvested: sql<number>`coalesce(sum(${userBets.investedAmount}::numeric), 0)`,
                    confirmedBets: sql<number>`count(*) filter (where ${userBets.status} in ('confirmed', 'redeemed'))::int`,
                    redeemedBets: sql<number>`count(*) filter (where ${userBets.status} = 'redeemed')::int`,
                    totalWinnings: sql<number>`coalesce(sum(${userBets.redemptionAmount}::numeric) filter (where ${userBets.status} = 'redeemed'), 0)`,
                    pendingBets: sql<number>`count(*) filter (where ${userBets.status} = 'pending')::int`,
                })
                .from(userBets)
                .where(eq(userBets.publicKey, publicKey));

            const stats = statsResult[0];
            const netPnL = Number(stats.totalWinnings) - Number(stats.totalInvested);
            const winRate = stats.confirmedBets > 0 
                ? (stats.redeemedBets / stats.confirmedBets) * 100 
                : 0;

            return {
                success: true,
                stats: {
                    totalBets: stats.totalBets,
                    confirmedBets: stats.confirmedBets,
                    pendingBets: stats.pendingBets,
                    betsWon: stats.redeemedBets,
                    betsLost: stats.confirmedBets - stats.redeemedBets,
                    totalInvested: Number(stats.totalInvested),
                    totalWinnings: Number(stats.totalWinnings),
                    netPnL,
                    winRate: Math.round(winRate * 10) / 10,
                },
                backfilledCount,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching user stats:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch user stats',
            };
        }
    }, {
        query: t.Object({
            backfill: t.Optional(t.String()),
        })
    })

    // Get user bet history
    .get('/history/:publicKey', async ({ params, query, set }) => {
        try {
            const { publicKey } = params;
            const limit = parseInt(query.limit || '50');
            const offset = parseInt(query.offset || '0');

            // Run reconciliation first
            await reconcileUserBets(publicKey);

            const bets = await db
                .select()
                .from(userBets)
                .where(eq(userBets.publicKey, publicKey))
                .orderBy(desc(userBets.createdAt))
                .limit(limit)
                .offset(offset);

            const countResult = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(userBets)
                .where(eq(userBets.publicKey, publicKey));

            return {
                success: true,
                bets: bets.map(bet => ({
                    ...bet,
                    contracts: Number(bet.contracts),
                    entryPrice: Number(bet.entryPrice),
                    investedAmount: Number(bet.investedAmount),
                    redemptionAmount: bet.redemptionAmount ? Number(bet.redemptionAmount) : null,
                })),
                total: countResult[0]?.count || 0,
                limit,
                offset,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching bet history:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch bet history',
            };
        }
    }, {
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
        })
    });

