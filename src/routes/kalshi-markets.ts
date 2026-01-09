import { Elysia, t } from 'elysia';
import { getRedisClient } from '../lib/redis';

const DFLOW_METADATA_API = 'https://b.prediction-markets-api.dflow.net';
const DFLOW_QUOTE_API = 'https://b.quote-api.dflow.net';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Cache TTL for user trades (5 minutes)
const USER_TRADES_CACHE_TTL = 5 * 60;

// Cache for crypto prices (5 minute TTL)
interface CryptoCache {
    data: any;
    timestamp: number;
}
const cryptoCache: Map<string, CryptoCache> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// USDC mint on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// CASH mint on Solana mainnet (DFlow's stablecoin)
const CASH_MINT = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';

interface DFlowMarketAccount {
    yesMint: string;
    noMint: string;
    marketLedger: string;
    redemptionStatus?: string;
}

interface DFlowMarket {
    ticker: string;
    title: string;
    subtitle?: string;
    status: 'initialized' | 'active' | 'inactive' | 'closed' | 'determined' | 'finalized';
    result?: string;
    accounts: Record<string, DFlowMarketAccount>;
    volume24h?: number;
    openInterest?: number;
    yesPrice?: number;
    noPrice?: number;
    closeTime?: string;
    expirationTime?: string;
}

interface DFlowEvent {
    ticker: string;
    title: string;
    subtitle?: string;
    seriesTicker: string;
    category?: string;
    markets?: DFlowMarket[];
}

interface DFlowEventsResponse {
    events: DFlowEvent[];
    cursor?: string;
}

interface DFlowTagsByCategories {
    tagsByCategories: Record<string, string[]>;
}

interface UserTrade {
    tradeId: string;
    signature: string;
    mint: string;
    count: number;
    price: number;
    usdcAmount: number;
    side: 'buy' | 'sell';
    timestamp: number;
    createdTime: number;
    type: string;
    description?: string;
}

/**
 * Shared helper function to fetch user trades for multiple mints
 * Uses Redis caching to avoid redundant Helius API calls
 */
async function fetchUserTradesForMints(
    publicKey: string, 
    mints: string[]
): Promise<Record<string, UserTrade[]>> {
    // Get Helius API key
    let heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
        const rpcUrl = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC_ENDPOINT;
        if (rpcUrl) {
            const match = rpcUrl.match(/api-key=([a-f0-9-]+)/);
            heliusApiKey = match?.[1];
        }
    }
    
    if (!heliusApiKey) {
        throw new Error('Helius API key not configured');
    }

    const redis = getRedisClient();
    const result: Record<string, UserTrade[]> = {};
    const uncachedMints: string[] = [];
    
    // Check Redis cache for each mint
    for (const mint of mints) {
        const cacheKey = `user-trades:${publicKey}:${mint}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                result[mint] = JSON.parse(cached);
                console.log(`[User Trades] Cache hit for ${mint.slice(0, 8)}...`);
            } else {
                uncachedMints.push(mint);
            }
        } catch (err) {
            console.error(`[User Trades] Redis get error:`, err);
            uncachedMints.push(mint);
        }
    }
    
    // If all mints were cached, return early
    if (uncachedMints.length === 0) {
        console.log(`[User Trades] All ${mints.length} mints served from cache`);
        return result;
    }
    
    console.log(`[User Trades] Fetching trades for ${publicKey}, ${uncachedMints.length} uncached mints`);

    // Fetch user's transaction history from Helius
    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
    
    interface SignatureResult {
        signature: string;
        slot?: number;
        err?: unknown;
        memo?: string;
        blockTime?: number;
    }
    
    let allSignatures: SignatureResult[] = [];
    let beforeSignature: string | undefined = undefined;
    const MAX_BATCHES = 5; // Fetch up to 500 signatures
    
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const sigResponse: Response = await fetch(heliusUrl, {
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

        if (!sigResponse.ok) {
            throw new Error(`Helius API error: ${sigResponse.status}`);
        }

        const signaturesResult: { result?: SignatureResult[] } = await sigResponse.json();
        const batchSignatures: SignatureResult[] = signaturesResult.result || [];
        
        if (batchSignatures.length === 0) break;
        
        allSignatures = [...allSignatures, ...batchSignatures];
        beforeSignature = batchSignatures[batchSignatures.length - 1].signature;
        
        // Stop if we've found enough or if we got fewer than requested
        if (batchSignatures.length < 100) break;
    }

    console.log(`[User Trades] Found ${allSignatures.length} signatures across ${Math.ceil(allSignatures.length / 100)} batches`);

    if (allSignatures.length === 0) {
        // Cache empty results for all mints
        for (const mint of uncachedMints) {
            result[mint] = [];
            const cacheKey = `user-trades:${publicKey}:${mint}`;
            try {
                await redis.setex(cacheKey, USER_TRADES_CACHE_TTL, JSON.stringify([]));
            } catch (err) {
                console.error(`[User Trades] Redis set error:`, err);
            }
        }
        return result;
    }

    // Fetch parsed transactions using Helius Enhanced Transactions API
    let allParsedTransactions: any[] = [];
    const PARSE_BATCH_SIZE = 100;
    
    for (let i = 0; i < allSignatures.length; i += PARSE_BATCH_SIZE) {
        const batch = allSignatures.slice(i, i + PARSE_BATCH_SIZE);
        const parsedTxResponse = await fetch(
            `https://api.helius.xyz/v0/transactions?api-key=${heliusApiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactions: batch.map((s: any) => s.signature),
                }),
            }
        );

        if (!parsedTxResponse.ok) {
            const errorText = await parsedTxResponse.text();
            console.error('[User Trades] Helius Enhanced API error:', errorText);
            continue;
        }

        const parsedBatch = await parsedTxResponse.json();
        allParsedTransactions = [...allParsedTransactions, ...parsedBatch];
    }

    console.log(`[User Trades] Parsed ${allParsedTransactions.length} transactions`);

    // Create a Set for faster mint lookup
    const mintSet = new Set(uncachedMints);
    
    // Initialize results for uncached mints
    for (const mint of uncachedMints) {
        result[mint] = [];
    }

    // DFlow uses CASH token internally
    const DFLOW_CASH_MINT = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';

    // Process transactions once and extract trades for ALL mints
    for (const tx of allParsedTransactions) {
        if (!tx || tx.transactionError) continue;

        // Look for PLACE_BET transactions
        if (tx.type !== 'PLACE_BET' && tx.type !== 'SWAP') continue;

        const tokenTransfers = tx.tokenTransfers || [];
        const accountData = tx.accountData || [];
        
        // Find all matching mints in this transaction
        const mintsInTx: Map<string, number> = new Map();
        
        // Check accountData for outcome tokens
        for (const account of accountData) {
            if (account.tokenBalanceChanges) {
                for (const change of account.tokenBalanceChanges) {
                    if (mintSet.has(change.mint)) {
                        const decimals = change.rawTokenAmount?.decimals || 6;
                        const amount = parseInt(change.rawTokenAmount?.tokenAmount || '0') / Math.pow(10, decimals);
                        if (amount > 0) {
                            mintsInTx.set(change.mint, amount);
                        }
                    }
                }
            }
        }

        if (mintsInTx.size === 0) continue;

        // Get USDC amount from tokenTransfers
        let usdcAmount = 0;
        for (const transfer of tokenTransfers) {
            if (transfer.mint === USDC_MINT) {
                usdcAmount = Math.abs(transfer.tokenAmount || 0);
                break;
            }
        }
        
        // If no USDC, check CASH token
        if (usdcAmount === 0) {
            for (const transfer of tokenTransfers) {
                if (transfer.mint === DFLOW_CASH_MINT) {
                    usdcAmount = Math.abs(transfer.tokenAmount || 0);
                    break;
                }
            }
        }

        // Add trade for each matching mint
        for (const [mint, outcomeTokenAmount] of mintsInTx) {
            const pricePerContract = outcomeTokenAmount > 0 ? usdcAmount / outcomeTokenAmount : 0;
            
            result[mint].push({
                tradeId: tx.signature,
                signature: tx.signature,
                mint: mint,
                count: outcomeTokenAmount,
                price: pricePerContract,
                usdcAmount: usdcAmount,
                side: 'buy',
                timestamp: tx.timestamp,
                createdTime: tx.timestamp,
                type: tx.type,
                description: tx.description,
            });
        }
    }

    // Sort and cache results for each mint
    for (const mint of uncachedMints) {
        result[mint].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        const cacheKey = `user-trades:${publicKey}:${mint}`;
        try {
            await redis.setex(cacheKey, USER_TRADES_CACHE_TTL, JSON.stringify(result[mint]));
            console.log(`[User Trades] Cached ${result[mint].length} trades for ${mint.slice(0, 8)}...`);
        } catch (err) {
            console.error(`[User Trades] Redis set error:`, err);
        }
    }

    return result;
}

/**
 * Crypto price cache routes
 * Provides cached crypto price data from CoinGecko
 */
const cryptoCacheRoutes = new Elysia({ prefix: '/api/crypto-cache' })
    .get('/:coinId/details', async ({ params, set }) => {
        try {
            const { coinId } = params;
            const cacheKey = `${coinId}-details`;
            
            // Check cache
            const cached = cryptoCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
            }

            // Fetch current price and 24h change
            const priceResponse = await fetch(
                `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`
            );

            if (!priceResponse.ok) {
                throw new Error(`CoinGecko API error: ${priceResponse.status}`);
            }

            const priceData = await priceResponse.json();
            const coinData = priceData[coinId];

            if (!coinData) {
                set.status = 404;
                return { success: false, error: `Coin ${coinId} not found` };
            }

            // Fetch 24h price history (hourly data points)
            const historyResponse = await fetch(
                `${COINGECKO_API}/coins/${coinId}/market_chart?vs_currency=usd&days=1`
            );

            if (!historyResponse.ok) {
                throw new Error(`CoinGecko history API error: ${historyResponse.status}`);
            }

            const historyData = await historyResponse.json();
            
            // Transform price history to expected format
            const priceHistory = (historyData.prices || []).map((point: [number, number]) => ({
                timestamp: new Date(point[0]).toISOString(),
                price: point[1],
            }));

            const result = {
                success: true,
                coinId,
                currentPrice: coinData.usd,
                priceChange24h: coinData.usd_24h_change || 0,
                priceHistory,
                timestamp: new Date().toISOString(),
            };

            // Cache the result
            cryptoCache.set(cacheKey, { data: result, timestamp: Date.now() });

            return result;
        } catch (error) {
            console.error('Error fetching crypto price:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch crypto price',
            };
        }
    });

/**
 * Kalshi Markets routes via DFlow API
 * Provides access to prediction markets data from Kalshi via DFlow's infrastructure
 */
export const kalshiMarketsRoutes = new Elysia()
    .use(cryptoCacheRoutes)
    .group('/api/kalshi', (app) => app
    // Get all events with nested markets
    .get('/events', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const params = new URLSearchParams();
            params.append('withNestedMarkets', 'true');
            params.append('limit', query.limit?.toString() || '100');
            
            if (query.status) params.append('status', query.status);
            if (query.category) params.append('category', query.category);
            if (query.seriesTickers) params.append('seriesTickers', query.seriesTickers);
            if (query.cursor) params.append('cursor', query.cursor);

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/events?${params.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data: DFlowEventsResponse = await response.json();

            return {
                success: true,
                events: data.events,
                cursor: data.cursor,
                count: data.events.length,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching Kalshi events:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch Kalshi events',
            };
        }
    }, {
        query: t.Object({
            limit: t.Optional(t.String()),
            status: t.Optional(t.String()),
            category: t.Optional(t.String()),
            seriesTickers: t.Optional(t.String()),
            cursor: t.Optional(t.String()),
        })
    })

    // Get categories and tags
    .get('/categories', async ({ set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/tags_by_categories`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data: DFlowTagsByCategories = await response.json();

            return {
                success: true,
                categories: data.tagsByCategories,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching categories:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch categories',
            };
        }
    })

    // Search events
    .get('/search', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const params = new URLSearchParams();
            params.append('query', query.q || '');
            params.append('limit', query.limit?.toString() || '20');

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/search?${params.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                success: true,
                events: data.events || [],
                count: data.events?.length || 0,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error searching Kalshi events:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to search events',
            };
        }
    }, {
        query: t.Object({
            q: t.Optional(t.String()),
            limit: t.Optional(t.String()),
        })
    })

    // Get market by ticker
    .get('/market/:ticker', async ({ params, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/market/${params.ticker}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                success: true,
                market: data,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching market:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch market',
            };
        }
    })

    // Get crypto series tickers (cached in memory for 5 minutes)
    .get('/crypto/series', async ({ set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/series?category=Crypto&limit=500`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const series = data.series || [];

            // Group by tags
            const byTag: Record<string, string[]> = {
                'All': series.map((s: any) => s.ticker),
            };

            for (const s of series) {
                const tags = s.tags || [];
                for (const tag of tags) {
                    if (!byTag[tag]) byTag[tag] = [];
                    byTag[tag].push(s.ticker);
                }
            }

            return {
                success: true,
                series,
                byTag,
                count: series.length,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching crypto series:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch crypto series',
            };
        }
    })

    // Get crypto markets - fetches all crypto series dynamically
    .get('/crypto', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            // Step 1: Get all crypto series from DFlow
            const seriesResponse = await fetch(
                `${DFLOW_METADATA_API}/api/v1/series?category=Crypto&limit=500`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!seriesResponse.ok) {
                throw new Error(`DFlow API error fetching series: ${seriesResponse.status}`);
            }

            const seriesData = await seriesResponse.json();
            const allSeries = seriesData.series || [];
            
            // Create tag mappings from series data - Only BTC, ETH, SOL
            const seriesByTag: Record<string, string[]> = {
                'All': [],
                'BTC': [],
                'ETH': [],
                'SOL': [],
            };
            
            // Also track by frequency
            const seriesByFrequency: Record<string, string[]> = {
                'hourly': [],
                'daily': [],
                'weekly': [],
                'monthly': [],
                'annual': [],
            };
            
            for (const s of allSeries) {
                const ticker = s.ticker;
                const title = (s.title || '').toLowerCase();
                const tags = s.tags || [];
                
                // Only include BTC, ETH, SOL series
                let isBTC = tags.includes('BTC') || title.includes('bitcoin') || title.includes('btc');
                let isETH = tags.includes('ETH') || title.includes('ethereum') || title.includes('eth');
                let isSOL = tags.includes('SOL') || title.includes('solana') || title.includes('sol');
                
                // Skip if not BTC, ETH, or SOL
                if (!isBTC && !isETH && !isSOL) continue;
                
                seriesByTag['All'].push(ticker);
                
                if (isBTC) {
                    seriesByTag['BTC'].push(ticker);
                }
                if (isETH) {
                    seriesByTag['ETH'].push(ticker);
                }
                if (isSOL) {
                    seriesByTag['SOL'].push(ticker);
                }
                
                // Map by frequency
                const freq = s.frequency || '';
                if (freq === 'hourly') seriesByFrequency['hourly'].push(ticker);
                if (freq === 'daily') seriesByFrequency['daily'].push(ticker);
                if (freq === 'weekly') seriesByFrequency['weekly'].push(ticker);
                if (freq === 'monthly') seriesByFrequency['monthly'].push(ticker);
                if (freq === 'annual' || freq === 'one_off') seriesByFrequency['annual'].push(ticker);
            }

            // Determine which series to fetch based on tag filter
            const tag = query.tags;
            let seriesToFetch = seriesByTag['All'];
            
            if (tag && tag !== 'All' && seriesByTag[tag]) {
                seriesToFetch = seriesByTag[tag];
            }

            // Step 2: Fetch events in batches (API limit is 25 tickers per request)
            const allEvents: DFlowEvent[] = [];
            const batchSize = 25;
            
            for (let i = 0; i < seriesToFetch.length; i += batchSize) {
                const batch = seriesToFetch.slice(i, i + batchSize);
                const params = new URLSearchParams();
                params.append('withNestedMarkets', 'true');
                params.append('limit', '100');
                params.append('seriesTickers', batch.join(','));
                if (query.status && query.status !== '') params.append('status', query.status);

                const response = await fetch(
                    `${DFLOW_METADATA_API}/api/v1/events?${params.toString()}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                        },
                    }
                );

                if (response.ok) {
                    const data: DFlowEventsResponse = await response.json();
                    allEvents.push(...data.events);
                }
            }
            
            // Deduplicate by ticker
            const eventMap = new Map<string, DFlowEvent>();
            for (const event of allEvents) {
                eventMap.set(event.ticker, event);
            }
            let cryptoEvents = Array.from(eventMap.values());

            // Sort by total volume across all markets
            cryptoEvents.sort((a, b) => {
                const volA = a.markets?.reduce((sum, m) => sum + ((m as any).volume || 0), 0) || 0;
                const volB = b.markets?.reduce((sum, m) => sum + ((m as any).volume || 0), 0) || 0;
                return volB - volA;
            });

            return {
                success: true,
                events: cryptoEvents,
                cursor: null,
                count: cryptoEvents.length,
                tags: ['All', 'BTC', 'ETH', 'SOL'],
                seriesByFrequency, // Include frequency data for frontend filtering
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching crypto events:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch crypto events',
            };
        }
    }, {
        query: t.Object({
            limit: t.Optional(t.String()),
            tags: t.Optional(t.String()),
            status: t.Optional(t.String()),
        })
    })

    // Get live market data
    .get('/live', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const params = new URLSearchParams();
            if (query.eventTicker) params.append('eventTicker', query.eventTicker);
            params.append('limit', query.limit?.toString() || '50');

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/live_data?${params.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                success: true,
                liveData: data,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching live data:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch live data',
            };
        }
    }, {
        query: t.Object({
            eventTicker: t.Optional(t.String()),
            limit: t.Optional(t.String()),
        })
    })

    // Get orderbook for a market
    .get('/orderbook/:ticker', async ({ params, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/orderbook/${params.ticker}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                success: true,
                orderbook: data,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching orderbook:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch orderbook',
            };
        }
    })

    // Get order quote from DFlow Quote API
    // This returns a transaction that the user needs to sign
    .get('/quote', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const { userPublicKey, marketTicker, side, amount, slippageBps, outputMint: providedOutputMint } = query;

            if (!userPublicKey || !marketTicker || !side || !amount) {
                set.status = 400;
                return { success: false, error: 'Missing required parameters: userPublicKey, marketTicker, side, amount' };
            }

            const inputMint = USDC_MINT;
            let outputMint = providedOutputMint;

            // If outputMint not provided, fetch from market details
            if (!outputMint) {
                const marketResponse = await fetch(
                    `${DFLOW_METADATA_API}/api/v1/market/${marketTicker}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                        },
                    }
                );

                if (!marketResponse.ok) {
                    const errText = await marketResponse.text();
                    console.error('Market fetch error:', errText);
                    throw new Error(`Failed to fetch market: ${marketResponse.status}`);
                }

                const market = await marketResponse.json();
                
                // Debug log the market structure
                console.log('Market response for', marketTicker, ':', JSON.stringify(market, null, 2));
                
                // Prioritize USDC account since that's our input token
                // USDC accounts are more likely to be initialized
                let accounts = null;
                if (market.accounts) {
                    // First try USDC account (our input token)
                    if (market.accounts[USDC_MINT]) {
                        accounts = market.accounts[USDC_MINT];
                        console.log('Using USDC account for market');
                    }
                    // Then try CASH account
                    else if (market.accounts[CASH_MINT]) {
                        accounts = market.accounts[CASH_MINT];
                        console.log('Using CASH account for market');
                    }
                    // Legacy formats
                    else if (market.accounts.solana || market.accounts.Solana || market.accounts.SOLANA || market.accounts.mainnet) {
                        accounts = market.accounts.solana || market.accounts.Solana || market.accounts.SOLANA || market.accounts.mainnet;
                        console.log('Using legacy account format');
                    }
                    // Fallback to first account
                    else {
                        accounts = Object.values(market.accounts)[0];
                        console.log('Using first available account');
                    }
                }
                
                // If market has yesMint/noMint directly at the top level
                if (!accounts && (market.yesMint || market.noMint)) {
                    accounts = {
                        yesMint: market.yesMint,
                        noMint: market.noMint,
                        marketLedger: market.marketLedger,
                    };
                }
                
                console.log('Extracted accounts:', accounts);
                console.log('Market isInitialized:', accounts?.isInitialized);
                
                if (!accounts) {
                    throw new Error(`Market accounts not found. Market structure: ${JSON.stringify(Object.keys(market))}`);
                }

                outputMint = side === 'yes' ? accounts.yesMint : accounts.noMint;

                if (!outputMint) {
                    throw new Error(`${side}Mint not found for market. Available keys: ${JSON.stringify(Object.keys(accounts))}`);
                }
            }

            console.log(`Trading ${side} on ${marketTicker}: inputMint=${inputMint}, outputMint=${outputMint}`);

            // Build query params for Quote API
            // Note: Don't use restrictive routing options as they can prevent 
            // auto-initialization of uninitialized markets
            const params = new URLSearchParams({
                userPublicKey,
                inputMint,
                outputMint,
                amount: amount.toString(),
                slippageBps: (slippageBps || 100).toString(),
            });

            // Get order quote from DFlow Quote API
            const quoteResponse = await fetch(
                `${DFLOW_QUOTE_API}/order?${params.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!quoteResponse.ok) {
                const errorText = await quoteResponse.text();
                console.error('DFlow Quote API error:', errorText);
                
                let errorJson;
                try {
                    errorJson = JSON.parse(errorText);
                } catch {
                    errorJson = { msg: errorText };
                }
                
                // Handle route_not_found - the market may not be initialized or available
                // According to DFlow docs, the /order endpoint should auto-initialize markets,
                // but if we get route_not_found, the market might not be tradeable yet
                if (errorJson.code === 'route_not_found') {
                    console.log('Route not found - market may not be initialized or available on DFlow');
                    
                    // Log all available markets for this event to help debug
                    try {
                        // Extract event ticker from market ticker (e.g., KXBTCD-26JAN0817 from KXBTCD-26JAN0817-T89999.99)
                        const eventTicker = marketTicker.split('-T')[0];
                        console.log('Fetching all markets for event:', eventTicker);
                        
                        const eventResponse = await fetch(
                            `${DFLOW_METADATA_API}/api/v1/events?withNestedMarkets=true&eventTickers=${eventTicker}`,
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-api-key': apiKey,
                                },
                            }
                        );
                        
                        if (eventResponse.ok) {
                            const eventData = await eventResponse.json();
                            const event = eventData.events?.[0];
                            if (event?.markets) {
                                console.log(`Found ${event.markets.length} markets for event ${eventTicker}:`);
                                event.markets.forEach((m: any) => {
                                    const priceMatch = m.yesSubTitle?.match(/\$?([\d,]+(?:\.\d+)?)/);
                                    const price = priceMatch ? priceMatch[1] : 'unknown';
                                    const accountKeys = Object.keys(m.accounts || {});
                                    const firstAccount = accountKeys.length > 0 ? m.accounts[accountKeys[0]] : null;
                                    console.log(`  - ${m.ticker}: $${price}, yesMint=${firstAccount?.yesMint?.slice(0,8)}..., noMint=${firstAccount?.noMint?.slice(0,8)}..., isInit=${firstAccount?.isInitialized}`);
                                });
                                console.log('Requested outputMint:', outputMint);
                            }
                        }
                    } catch (debugErr) {
                        console.log('Debug fetch error:', debugErr);
                    }
                    
                    // Try the prediction-market-init endpoint as fallback
                    // According to DFlow docs: payer = user's public key, outcomeMint = the outcome token mint
                    const initCheckParams = new URLSearchParams({
                        payer: userPublicKey,
                        outcomeMint: outputMint,
                    });
                    
                    console.log('Trying prediction-market-init endpoint...');
                    const initResponse = await fetch(
                        `${DFLOW_QUOTE_API}/prediction-market-init?${initCheckParams.toString()}`,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': apiKey,
                            },
                        }
                    );
                    
                    console.log('Init response status:', initResponse.status);
                    
                    if (initResponse.ok) {
                        const initData = await initResponse.json();
                        console.log('Init response data:', JSON.stringify(initData, null, 2));
                        
                        if (initData.transaction) {
                            return {
                                success: true,
                                needsInit: true,
                                quote: {
                                    ...initData,
                                    marketTicker,
                                    side,
                                    inputMint,
                                    outputMint,
                                    message: 'This market needs to be initialized first. Sign this transaction to initialize it, then try trading again.',
                                },
                                timestamp: new Date().toISOString(),
                            };
                        }
                    } else {
                        const initErrorText = await initResponse.text();
                        console.log('Init response error:', initResponse.status, initErrorText);
                        
                        // Parse error for specific codes
                        try {
                            const initError = JSON.parse(initErrorText);
                            if (initError.code === 'unknown_outcome_mint') {
                                return {
                                    success: false,
                                    error: `This price level ($${marketTicker.split('-T')[1]?.replace('.', ',') || 'unknown'}) is not available on DFlow yet. Please try a different price level closer to the current market price.`,
                                    timestamp: new Date().toISOString(),
                                };
                            }
                        } catch {}
                    }
                    
                    // If init check also fails, provide helpful message
                    return {
                        success: false,
                        error: 'This price level is not available for trading yet. Try a price level closer to the current market price, or try again later.',
                        timestamp: new Date().toISOString(),
                    };
                }
                
                throw new Error(`DFlow Quote API error: ${quoteResponse.status} - ${errorJson.msg || errorText}`);
            }

            const quoteData = await quoteResponse.json();
            
            // Log the full quote response for debugging
            console.log('DFlow quote response:', JSON.stringify(quoteData, null, 2));

            return {
                success: true,
                quote: {
                    ...quoteData,
                    marketTicker,
                    side,
                    inputMint,
                    outputMint,
                },
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error getting quote:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get quote',
            };
        }
    }, {
        query: t.Object({
            userPublicKey: t.String(),
            marketTicker: t.String(),
            side: t.String(),
            amount: t.String(),
            slippageBps: t.Optional(t.String()),
            outputMint: t.Optional(t.String()),
        })
    })

    // Get user positions using DFlow's recommended approach
    // https://pond.dflow.net/quickstart/user-prediction-positions
    .get('/positions/:publicKey', async ({ params, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            const rpcEndpoint = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
            
            // Step 1: Fetch Token-2022 accounts (used by DFlow prediction markets)
            const tokenAccountsResponse = await fetch(rpcEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTokenAccountsByOwner',
                    params: [
                        params.publicKey,
                        { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, // Token-2022 program
                        { encoding: 'jsonParsed' }
                    ]
                })
            });

            if (!tokenAccountsResponse.ok) {
                throw new Error('Failed to fetch token accounts from Solana RPC');
            }

            const tokenAccountsData = await tokenAccountsResponse.json();
            const tokenAccounts = tokenAccountsData.result?.value || [];
            
            // Map to simpler structure and filter non-zero balances
            const userTokens = tokenAccounts
                .map((account: any) => {
                    const info = account.account?.data?.parsed?.info;
                    return {
                        mint: info?.mint,
                        balance: info?.tokenAmount?.uiAmount || 0,
                        decimals: info?.tokenAmount?.decimals || 6,
                    };
                })
                .filter((t: any) => t.balance > 0 && t.mint);

            if (userTokens.length === 0) {
                return {
                    success: true,
                    positions: [],
                    message: 'No token balances found',
                    timestamp: new Date().toISOString(),
                };
            }

            const allMintAddresses = userTokens.map((t: any) => t.mint);
            console.log(`Found ${allMintAddresses.length} non-zero token balances for ${params.publicKey}`);

            // Step 2: Filter to get only prediction market outcome mints
            const filterResponse = await fetch(
                `${DFLOW_METADATA_API}/api/v1/filter_outcome_mints`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey && { 'x-api-key': apiKey }),
                    },
                    body: JSON.stringify({ addresses: allMintAddresses }),
                }
            );

            if (!filterResponse.ok) {
                console.error('Failed to filter outcome mints:', await filterResponse.text());
                throw new Error('Failed to filter outcome mints');
            }

            const filterData = await filterResponse.json();
            const predictionMintAddresses = filterData.outcomeMints || [];
            
            console.log(`Found ${predictionMintAddresses.length} prediction market tokens`);

            if (predictionMintAddresses.length === 0) {
                return {
                    success: true,
                    positions: [],
                    message: 'No prediction market positions found',
                    timestamp: new Date().toISOString(),
                };
            }

            // Step 3: Fetch market details for all outcome tokens in batch
            const marketsResponse = await fetch(
                `${DFLOW_METADATA_API}/api/v1/markets/batch`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey && { 'x-api-key': apiKey }),
                    },
                    body: JSON.stringify({ mints: predictionMintAddresses }),
                }
            );

            if (!marketsResponse.ok) {
                console.error('Failed to fetch markets batch:', await marketsResponse.text());
                throw new Error('Failed to fetch market details');
            }

            const marketsData = await marketsResponse.json();
            const markets = marketsData.markets || [];
            
            console.log(`Got details for ${markets.length} markets`);

            // Create a map by mint address for efficient lookup
            const marketsByMint = new Map<string, any>();
            markets.forEach((market: any) => {
                Object.values(market.accounts || {}).forEach((account: any) => {
                    if (account.yesMint) marketsByMint.set(account.yesMint, { ...market, _mintType: 'yes' });
                    if (account.noMint) marketsByMint.set(account.noMint, { ...market, _mintType: 'no' });
                });
            });

            // Step 4: Build positions with market data
            const positions = userTokens
                .filter((token: any) => predictionMintAddresses.includes(token.mint))
                .map((token: any) => {
                    const marketData = marketsByMint.get(token.mint);
                    
                    if (!marketData) {
                        return {
                            mint: token.mint,
                            quantity: token.balance,
                            side: 'unknown' as const,
                            marketTitle: `Unknown Token`,
                            eventTitle: token.mint.slice(0, 8) + '...',
                        };
                    }

                    // Determine if YES or NO token
                    const isYesToken = Object.values(marketData.accounts || {}).some(
                        (account: any) => account.yesMint === token.mint
                    );
                    const side = isYesToken ? 'yes' : 'no';
                    
                    // Get current price
                    const currentPrice = side === 'yes'
                        ? (marketData.yesAsk || marketData.yesBid || 0.5)
                        : (marketData.noAsk || marketData.noBid || 0.5);
                    
                    // Calculate value (contracts * price)
                    const value = token.balance * currentPrice;

                    return {
                        marketTicker: marketData.ticker,
                        eventTicker: marketData.eventTicker,
                        marketTitle: marketData.yesSubTitle || marketData.title || marketData.ticker,
                        eventTitle: marketData.eventTitle || marketData.title,
                        side,
                        quantity: token.balance,
                        currentPrice,
                        value,
                        mint: token.mint,
                        status: marketData.status,
                        result: marketData.result,
                        closeTime: marketData.closeTime,
                    };
                });

            return {
                success: true,
                positions,
                tokenAccountCount: userTokens.length,
                predictionTokenCount: predictionMintAddresses.length,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching positions:', error);
            return {
                success: true,
                positions: [],
                error: error instanceof Error ? error.message : 'Failed to fetch positions',
                timestamp: new Date().toISOString(),
            };
        }
    })

    // Request redemption order for winning positions
    // https://pond.dflow.net/quickstart/redeem-outcome-tokens
    .get('/redeem', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const { userPublicKey, outcomeMint, amount } = query;

            if (!userPublicKey || !outcomeMint || !amount) {
                set.status = 400;
                return { success: false, error: 'Missing required parameters: userPublicKey, outcomeMint, amount' };
            }

            // Step 1: Check if outcome token is redeemable
            const marketResponse = await fetch(
                `${DFLOW_METADATA_API}/api/v1/market/by-mint/${outcomeMint}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey && { 'x-api-key': apiKey }),
                    },
                }
            );

            if (!marketResponse.ok) {
                throw new Error(`Failed to fetch market details: ${marketResponse.status}`);
            }

            const market = await marketResponse.json();
            console.log('Market for redemption:', JSON.stringify(market, null, 2));

            // Check if market is determined or finalized
            if (market.status !== 'determined' && market.status !== 'finalized') {
                set.status = 400;
                return { 
                    success: false, 
                    error: `Market is not determined. Current status: ${market.status}` 
                };
            }

            // Find settlement mint with open redemption
            let settlementMint: string | null = null;
            const result = market.result; // "yes", "no", or "" for scalar outcomes

            for (const [mint, account] of Object.entries(market.accounts || {}) as [string, DFlowMarketAccount][]) {
                if (account.redemptionStatus === 'open') {
                    // Case 1: Standard determined outcome
                    if (result === 'yes' && account.yesMint === outcomeMint) {
                        settlementMint = mint;
                        break;
                    } else if (result === 'no' && account.noMint === outcomeMint) {
                        settlementMint = mint;
                        break;
                    }
                    // Case 2: Scalar outcome (both YES and NO are redeemable)
                    else if (result === '' && (account as any).scalarOutcomePct !== undefined) {
                        if (account.yesMint === outcomeMint || account.noMint === outcomeMint) {
                            settlementMint = mint;
                            break;
                        }
                    }
                }
            }

            if (!settlementMint) {
                set.status = 400;
                return { 
                    success: false, 
                    error: 'Token is not redeemable. Either the market result does not match your position, or redemption is not open yet.' 
                };
            }

            console.log(`Redemption: ${outcomeMint} -> ${settlementMint}, amount: ${amount}`);

            // Step 2: Request redemption order from DFlow Quote API (outcome token -> CASH)
            const redeemParams = new URLSearchParams({
                userPublicKey,
                inputMint: outcomeMint,
                outputMint: settlementMint,
                amount: amount.toString(),
            });

            const redeemResponse = await fetch(
                `${DFLOW_QUOTE_API}/order?${redeemParams.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey && { 'x-api-key': apiKey }),
                    },
                }
            );

            if (!redeemResponse.ok) {
                const errorText = await redeemResponse.text();
                console.error('DFlow redemption error:', errorText);
                throw new Error(`Failed to get redemption order: ${redeemResponse.status}`);
            }

            const redeemData = await redeemResponse.json();
            console.log('Redemption order:', JSON.stringify(redeemData, null, 2));

            // Step 3: Only request CASH -> USDC swap if settlement is in CASH
            // If settlement is already USDC, user receives USDC directly - no swap needed!
            let swapData = null;
            if (settlementMint === CASH_MINT) {
                console.log('Settlement is in CASH, requesting CASH->USDC swap');
                const swapParams = new URLSearchParams({
                    userPublicKey,
                    inputMint: CASH_MINT,
                    outputMint: USDC_MINT,
                    amount: amount.toString(),
                    slippageBps: '50', // 0.5% slippage for stablecoin swap
                });

                const swapResponse = await fetch(
                    `${DFLOW_QUOTE_API}/order?${swapParams.toString()}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            ...(apiKey && { 'x-api-key': apiKey }),
                        },
                    }
                );

                if (swapResponse.ok) {
                    swapData = await swapResponse.json();
                    console.log('CASH->USDC swap order:', JSON.stringify(swapData, null, 2));
                } else {
                    // Log but don't fail - user will just receive CASH
                    const errorText = await swapResponse.text();
                    console.warn('CASH->USDC swap not available:', errorText);
                }
            } else {
                console.log('Settlement is in USDC, no swap needed - user receives USDC directly');
            }

            return {
                success: true,
                order: {
                    ...redeemData,
                    outcomeMint,
                    settlementMint,
                    marketTitle: market.title,
                    marketResult: result,
                },
                // Include the swap transaction if available
                swapOrder: swapData,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error requesting redemption:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to request redemption',
            };
        }
    }, {
        query: t.Object({
            userPublicKey: t.String(),
            outcomeMint: t.String(),
            amount: t.String(),
        })
    })

    // Get trades for a market or user's mints
    .get('/trades', async ({ query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const params = new URLSearchParams();
            params.append('limit', query.limit || '100');
            
            if (query.ticker) params.append('ticker', query.ticker);
            if (query.minTs) params.append('minTs', query.minTs);
            if (query.maxTs) params.append('maxTs', query.maxTs);
            if (query.cursor) params.append('cursor', query.cursor);

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/trades?${params.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                success: true,
                trades: data.trades || [],
                cursor: data.cursor,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching trades:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch trades',
            };
        }
    }, {
        query: t.Object({
            ticker: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            minTs: t.Optional(t.String()),
            maxTs: t.Optional(t.String()),
            cursor: t.Optional(t.String()),
        })
    })

    // Get user-specific trades for a market using Helius transaction history
    .get('/user-trades/:publicKey', async ({ params, query, set }) => {
        try {
            const { publicKey } = params;
            const { mint } = query;

            if (!mint) {
                set.status = 400;
                return { success: false, error: 'Missing required parameter: mint (outcome token mint address)' };
            }

            // Use the shared helper function
            const result = await fetchUserTradesForMints(publicKey, [mint]);
            
                return {
                    success: true,
                trades: result[mint] || [],
                count: (result[mint] || []).length,
                    timestamp: new Date().toISOString(),
                };
        } catch (error) {
            console.error('Error fetching user trades:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch user trades',
            };
        }
    }, {
        query: t.Object({
            mint: t.String(),
        })
    })

    // Batch endpoint: Get user trades for multiple mints at once
    .post('/user-trades-batch/:publicKey', async ({ params, body, set }) => {
        try {
            const { publicKey } = params;
            const { mints } = body as { mints: string[] };

            if (!mints || !Array.isArray(mints) || mints.length === 0) {
                set.status = 400;
                return { success: false, error: 'Missing required parameter: mints (array of outcome token mint addresses)' };
            }

            console.log(`[User Trades Batch] Fetching trades for ${publicKey}, ${mints.length} mints`);

            // Use the shared helper function
            const result = await fetchUserTradesForMints(publicKey, mints);

            return {
                success: true,
                tradesByMint: result,
                mintCount: mints.length,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching user trades batch:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch user trades',
            };
        }
    }, {
        body: t.Object({
            mints: t.Array(t.String()),
        })
    })

    // Get trades by outcome mint address
    .get('/trades/by-mint/:mint', async ({ params, query, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const queryParams = new URLSearchParams();
            queryParams.append('limit', query.limit || '100');
            if (query.cursor) queryParams.append('cursor', query.cursor);

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/trades/by-mint/${params.mint}?${queryParams.toString()}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                success: true,
                trades: data.trades || [],
                cursor: data.cursor,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching trades by mint:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch trades',
            };
        }
    }, {
        query: t.Object({
            limit: t.Optional(t.String()),
            cursor: t.Optional(t.String()),
        })
    })

    // Get market accounts for reference
    .get('/market-accounts/:ticker', async ({ params, set }) => {
        try {
            const apiKey = process.env.DFLOW_API_KEY;
            if (!apiKey) {
                set.status = 500;
                return { success: false, error: 'DFlow API key not configured' };
            }

            const response = await fetch(
                `${DFLOW_METADATA_API}/api/v1/market/${params.ticker}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`DFlow API error: ${response.status}`);
            }

            const market = await response.json();

            return {
                success: true,
                ticker: params.ticker,
                market,
                accounts: market.accounts || {},
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching market accounts:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch market accounts',
            };
        }
    }));

