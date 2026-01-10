/**
 * Backfill Positions Script
 *
 * Fetches user's prediction market positions using a hybrid approach:
 * 1. Fetch all Token-2022 accounts owned by the user (positions)
 * 2. Filter for outcome mints using DFlow API
 * 3. Get market details using DFlow API
 * 4. Fetch entry prices from Helius transaction history
 * 5. Store positions with entry prices in the database
 *
 * Usage:
 *   bun run scripts/backfill-trades.ts <publicKey>           - Backfill single wallet
 *   bun run scripts/backfill-trades.ts <pk1> <pk2> ...       - Backfill multiple wallets
 *   bun run scripts/backfill-trades.ts --all                 - Backfill all existing wallets in DB
 */

import { db } from '../src/db';
import { userBets } from '../src/db/schema';
import { eq } from 'drizzle-orm';

// Constants
const DFLOW_METADATA_API = 'https://b.prediction-markets-api.dflow.net';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

interface TokenAccount {
    mint: string;
    balance: number;
    rawBalance: string;
    decimals: number;
}

interface MarketData {
    ticker: string;
    yesSubTitle?: string;
    title?: string;
    closeTime?: number;
    status?: string;
    result?: string;
    accounts: Record<string, {
        yesMint: string;
        noMint: string;
        marketLedger: string;
    }>;
}

interface TradeInfo {
    entryPrice: number;
    investedAmount: number;
    timestamp: number;
    txSignature: string;
}

interface BackfillResult {
    publicKey: string;
    totalTokenAccounts: number;
    outcomeMints: number;
    positionsInserted: number;
    errors: number;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all Token-2022 accounts for a wallet using RPC
 */
async function fetchTokenAccounts(publicKey: string, rpcUrl: string): Promise<TokenAccount[]> {
    console.log(`  📡 Fetching Token-2022 accounts for ${publicKey.slice(0, 8)}...`);

    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
                publicKey,
                { programId: TOKEN_2022_PROGRAM_ID },
                { encoding: 'jsonParsed' }
            ]
        })
    });

    const result = await response.json() as {
        result?: {
            value: Array<{
                account: {
                    data: {
                        parsed: {
                            info: {
                                mint: string;
                                tokenAmount: {
                                    amount: string;
                                    uiAmount: number;
                                    decimals: number;
                                };
                            };
                        };
                    };
                };
            }>;
        };
    };

    if (!result.result?.value) {
        return [];
    }

    const tokens = result.result.value.map(({ account }) => {
        const info = account.data.parsed.info;
        return {
            mint: info.mint,
            rawBalance: info.tokenAmount.amount,
            balance: info.tokenAmount.uiAmount,
            decimals: info.tokenAmount.decimals,
        };
    });

    const nonZero = tokens.filter(t => t.balance > 0);
    console.log(`    Found ${tokens.length} token accounts, ${nonZero.length} with non-zero balance`);

    return nonZero;
}

/**
 * Filter tokens to get only prediction market outcome mints
 */
async function filterOutcomeMints(mints: string[], apiKey: string): Promise<string[]> {
    if (mints.length === 0) return [];

    console.log(`  🔍 Filtering ${mints.length} mints for outcome tokens...`);

    const response = await fetch(`${DFLOW_METADATA_API}/api/v1/filter_outcome_mints`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({ addresses: mints }),
    });

    if (!response.ok) {
        console.error(`    ❌ Failed to filter outcome mints: ${response.status}`);
        return [];
    }

    const data = await response.json() as { outcomeMints?: string[] };
    const outcomeMints = data.outcomeMints || [];

    console.log(`    Found ${outcomeMints.length} prediction market outcome tokens`);
    return outcomeMints;
}

/**
 * Fetch market details for outcome mints in batch
 */
async function fetchMarketsBatch(mints: string[], apiKey: string): Promise<Map<string, MarketData>> {
    if (mints.length === 0) return new Map();

    console.log(`  📊 Fetching market details for ${mints.length} outcome mints...`);

    const response = await fetch(`${DFLOW_METADATA_API}/api/v1/markets/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({ mints }),
    });

    if (!response.ok) {
        console.error(`    ❌ Failed to fetch markets batch: ${response.status}`);
        return new Map();
    }

    const data = await response.json() as { markets?: MarketData[] };
    const markets = data.markets || [];

    const marketsByMint = new Map<string, MarketData>();

    markets.forEach((market) => {
        Object.values(market.accounts || {}).forEach((account) => {
            marketsByMint.set(account.yesMint, market);
            marketsByMint.set(account.noMint, market);
        });
    });

    console.log(`    Mapped ${marketsByMint.size} mints to ${markets.length} markets`);
    return marketsByMint;
}

/**
 * Fetch entry prices using DFlow trades/by-mint API
 */
async function fetchEntryPrices(
    outcomeMints: string[],
    apiKey: string
): Promise<Map<string, TradeInfo>> {
    console.log(`  💰 Fetching trade prices from DFlow API...`);

    const entryPrices = new Map<string, TradeInfo>();

    for (const mint of outcomeMints) {
        try {
            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/trades/by-mint/${mint}?limit=100`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                continue;
            }

            interface DFlowTrade {
                count: number;
                createdTime: number;
                yesPrice: number;
                noPrice: number;
                price: number;
                takerSide: string;
                ticker: string;
                tradeId: string;
            }

            const data = await response.json() as { trades?: DFlowTrade[] };
            const trades = data.trades || [];

            if (trades.length > 0) {
                const recentTrade = trades[0];
                const rawPrice = recentTrade.yesPrice || recentTrade.price || 0;
                const entryPrice = rawPrice / 10000;
                const contracts = recentTrade.count || 1;
                const investedAmount = contracts * entryPrice;

                entryPrices.set(mint, {
                    entryPrice,
                    investedAmount,
                    timestamp: recentTrade.createdTime || Date.now() / 1000,
                    txSignature: `trade-${recentTrade.tradeId || mint.slice(0, 16)}`,
                });

                console.log(`    ✓ ${mint.slice(0, 8)}...: ${(entryPrice * 100).toFixed(1)}¢`);
            }

            await sleep(100);
        } catch (err) {
            console.error(`    ❌ Error for ${mint.slice(0, 8)}:`, err);
        }
    }

    console.log(`    Found prices for ${entryPrices.size}/${outcomeMints.length} positions`);
    return entryPrices;
}

/**
 * Fetch user's actual transaction times for each mint using Helius
 */
async function fetchTransactionTimes(
    publicKey: string,
    outcomeMints: string[],
    rpcUrl: string
): Promise<Map<string, { timestamp: number; txSignature: string }>> {
    console.log(`  ⏰ Fetching transaction times...`);

    const txTimes = new Map<string, { timestamp: number; txSignature: string }>();
    const mintSet = new Set(outcomeMints);

    const apiKeyMatch = rpcUrl.match(/api-key=([a-f0-9-]+)/);
    const heliusApiKey = apiKeyMatch?.[1];

    if (!heliusApiKey) {
        console.log(`    ⚠️ No Helius API key`);
        return txTimes;
    }

    const sigResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignaturesForAddress',
            params: [publicKey, { limit: 200 }]
        })
    });

    const sigResult = await sigResponse.json() as { result?: Array<{ signature: string }> };
    const signatures = sigResult.result || [];

    if (signatures.length === 0) return txTimes;

    const batch = signatures.slice(0, 100).map(s => s.signature);
    const response = await fetch(
        `https://api.helius.xyz/v0/transactions?api-key=${heliusApiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: batch }),
        }
    );

    if (!response.ok) return txTimes;

    interface HeliusTx {
        signature: string;
        timestamp: number;
        accountData?: Array<{
            tokenBalanceChanges?: Array<{
                mint: string;
                rawTokenAmount?: { tokenAmount: string };
            }>;
        }>;
    }

    const parsed: HeliusTx[] = await response.json();

    for (const tx of parsed) {
        if (!tx?.accountData) continue;

        for (const account of tx.accountData) {
            if (!account.tokenBalanceChanges) continue;

            for (const change of account.tokenBalanceChanges) {
                if (change.mint && mintSet.has(change.mint)) {
                    const amount = parseInt(change.rawTokenAmount?.tokenAmount || '0');
                    if (amount > 0 && !txTimes.has(change.mint)) {
                        txTimes.set(change.mint, {
                            timestamp: tx.timestamp,
                            txSignature: tx.signature,
                        });
                    }
                }
            }
        }
    }

    console.log(`    Found tx times for ${txTimes.size}/${outcomeMints.length} positions`);
    return txTimes;
}



/**
 * Backfill positions for a single wallet
 */
async function backfillWallet(publicKey: string, rpcUrl: string, apiKey: string): Promise<BackfillResult> {
    const result: BackfillResult = {
        publicKey,
        totalTokenAccounts: 0,
        outcomeMints: 0,
        positionsInserted: 0,
        errors: 0,
    };
    try {
        // 1. Fetch all Token-2022 accounts
        const tokenAccounts = await fetchTokenAccounts(publicKey, rpcUrl);
        result.totalTokenAccounts = tokenAccounts.length;

        if (tokenAccounts.length === 0) {
            console.log(`  ⚠️ No Token-2022 accounts found for ${publicKey.slice(0, 8)}...`);
            return result;
        }

        // 2. Filter for prediction market outcome mints
        const allMints = tokenAccounts.map(t => t.mint);
        const outcomeMints = await filterOutcomeMints(allMints, apiKey);
        result.outcomeMints = outcomeMints.length;

        if (outcomeMints.length === 0) {
            console.log(`  ⚠️ No prediction market positions found`);
            return result;
        }

        // 3. Fetch market details in batch
        const marketsByMint = await fetchMarketsBatch(outcomeMints, apiKey);

        // 4. Fetch entry prices from DFlow trades API
        const entryPrices = await fetchEntryPrices(outcomeMints, apiKey);

        // 5. Fetch actual transaction times from user's history
        const txTimes = await fetchTransactionTimes(publicKey, outcomeMints, rpcUrl);

        // 6. Get existing positions from DB (we'll update them if they exist)
        const existingBets = await db
            .select({ id: userBets.id, mint: userBets.mint })
            .from(userBets)
            .where(eq(userBets.publicKey, publicKey));

        const existingMintMap = new Map(existingBets.map(b => [b.mint, b.id]));
        console.log(`  📋 ${existingMintMap.size} positions already in DB (will update)`);

        // 7. Process each outcome token
        for (const token of tokenAccounts) {
            if (!outcomeMints.includes(token.mint)) continue;

            try {
                const market = marketsByMint.get(token.mint);
                if (!market) {
                    console.log(`    ⚠️ No market data for ${token.mint.slice(0, 8)}...`);
                    continue;
                }

                // Determine if YES or NO token
                let side: 'yes' | 'no' = 'yes';
                for (const account of Object.values(market.accounts || {})) {
                    if (account.yesMint === token.mint) {
                        side = 'yes';
                        break;
                    } else if (account.noMint === token.mint) {
                        side = 'no';
                        break;
                    }
                }

                // Get entry price from DFlow API
                const tradeInfo = entryPrices.get(token.mint);
                const entryPrice = tradeInfo?.entryPrice || 0;
                const investedAmount = tradeInfo?.investedAmount || 0;

                // Get actual transaction time from user's history
                const txTime = txTimes.get(token.mint);
                const txSignature = txTime?.txSignature || tradeInfo?.txSignature || `position-${token.mint.slice(0, 16)}`;
                const createdAt = txTime?.timestamp ? new Date(txTime.timestamp * 1000) : (tradeInfo?.timestamp ? new Date(tradeInfo.timestamp * 1000) : new Date());

                const existingId = existingMintMap.get(token.mint);

                if (existingId) {
                    // Update existing position
                    await db.update(userBets)
                        .set({
                            contracts: token.balance.toString(),
                            entryPrice: entryPrice.toString(),
                            investedAmount: investedAmount.toString(),
                            marketTitle: market.yesSubTitle || market.title || 'Unknown Market',
                            closeTime: market.closeTime ? new Date(market.closeTime * 1000) : null,
                        })
                        .where(eq(userBets.id, existingId));

                    const priceDisplay = entryPrice > 0 ? `@ ${(entryPrice * 100).toFixed(1)}¢` : '(no price)';
                    console.log(`    ♻️ Updated ${side.toUpperCase()} position: ${market.ticker} (${token.balance.toFixed(2)} contracts ${priceDisplay})`);
                } else {
                    // Insert new position
                    await db.insert(userBets).values({
                        publicKey,
                        marketTicker: market.ticker || 'Unknown',
                        marketTitle: market.yesSubTitle || market.title || 'Unknown Market',
                        side,
                        contracts: token.balance.toString(),
                        entryPrice: entryPrice.toString(),
                        investedAmount: investedAmount.toString(),
                        txSignature,
                        mint: token.mint,
                        closeTime: market.closeTime ? new Date(market.closeTime * 1000) : null,
                        status: 'confirmed',
                        confirmedAt: createdAt,
                        createdAt,
                    }).onConflictDoNothing();

                    const priceDisplay = entryPrice > 0 ? `@ ${(entryPrice * 100).toFixed(1)}¢` : '(no price)';
                    console.log(`    ✅ Inserted ${side.toUpperCase()} position: ${market.ticker} (${token.balance.toFixed(2)} contracts ${priceDisplay})`);
                }

                result.positionsInserted++;

                await sleep(50);
            } catch (err) {
                console.error(`    ❌ Error processing ${token.mint.slice(0, 8)}:`, err);
                result.errors++;
            }
        }

        console.log(`  ✅ Processed ${result.positionsInserted} positions (${result.errors} errors)`);
    } catch (err) {
        console.error(`  ❌ Error backfilling ${publicKey.slice(0, 8)}:`, err);
        result.errors++;
    }

    return result;
}

/**
 * Get all unique public keys from the database
 */
async function getAllPublicKeysFromDB(): Promise<string[]> {
    const results = await db
        .selectDistinct({ publicKey: userBets.publicKey })
        .from(userBets);

    return results.map(r => r.publicKey);
}

/**
 * Main function
 */
async function main(): Promise<void> {
    console.log('🚀 Positions Backfill Script (DFlow + Helius)\n');

    // Get environment variables
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
        console.error('❌ SOLANA_RPC_URL environment variable not set');
        process.exit(1);
    }

    const apiKey = process.env.DFLOW_API_KEY;
    if (!apiKey) {
        console.error('❌ DFLOW_API_KEY environment variable not set');
        process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage:');
        console.log('  bun run scripts/backfill-trades.ts <publicKey>       - Backfill single wallet');
        console.log('  bun run scripts/backfill-trades.ts <pk1> <pk2> ...   - Backfill multiple wallets');
        console.log('  bun run scripts/backfill-trades.ts --all             - Backfill all existing wallets in DB');
        process.exit(0);
    }

    let publicKeys: string[];

    if (args[0] === '--all') {
        console.log('📋 Fetching all wallets from database...\n');
        publicKeys = await getAllPublicKeysFromDB();

        if (publicKeys.length === 0) {
            console.log('⚠️ No wallets found in database');
            process.exit(0);
        }

        console.log(`Found ${publicKeys.length} unique wallets\n`);
    } else {
        publicKeys = args;
    }

    // Track overall stats
    const stats = {
        totalWallets: publicKeys.length,
        totalPositions: 0,
        totalErrors: 0,
    };

    // Process each wallet
    for (let i = 0; i < publicKeys.length; i++) {
        const pk = publicKeys[i];
        console.log(`\n[${i + 1}/${publicKeys.length}] Processing wallet: ${pk}`);

        const result = await backfillWallet(pk, rpcUrl, apiKey);

        stats.totalPositions += result.positionsInserted;
        stats.totalErrors += result.errors;

        // Rate limit between wallets
        if (i < publicKeys.length - 1) {
            await sleep(500);
        }
    }

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 BACKFILL SUMMARY');
    console.log('='.repeat(50));
    console.log(`  Wallets processed:   ${stats.totalWallets}`);
    console.log(`  Positions inserted:  ${stats.totalPositions}`);
    console.log(`  Errors:              ${stats.totalErrors}`);
    console.log('='.repeat(50));
    console.log('\n✅ Backfill complete!');
}

// Run
main().catch(console.error);
