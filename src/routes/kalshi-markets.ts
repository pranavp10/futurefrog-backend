import { Elysia, t } from 'elysia';

const DFLOW_METADATA_API = 'https://b.prediction-markets-api.dflow.net';

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

/**
 * Kalshi Markets routes via DFlow API
 * Provides access to prediction markets data from Kalshi via DFlow's infrastructure
 */
export const kalshiMarketsRoutes = new Elysia({ prefix: '/api/kalshi' })
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
            
            // Create tag mappings from series data
            const seriesByTag: Record<string, string[]> = {
                'All': [],
                'BTC': [],
                'ETH': [],
                'SOL': [],
                'Dogecoin': [],
                'SHIBA': [],
                'Hourly': [],
                'Pre-Market': [],
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
                seriesByTag['All'].push(ticker);
                
                // Map by tags
                const tags = s.tags || [];
                for (const tag of tags) {
                    if (seriesByTag[tag]) {
                        seriesByTag[tag].push(ticker);
                    }
                }
                
                // Also check title for tag keywords if no tags
                const title = (s.title || '').toLowerCase();
                if (title.includes('bitcoin') || title.includes('btc')) {
                    if (!seriesByTag['BTC'].includes(ticker)) seriesByTag['BTC'].push(ticker);
                }
                if (title.includes('ethereum') || title.includes('eth')) {
                    if (!seriesByTag['ETH'].includes(ticker)) seriesByTag['ETH'].push(ticker);
                }
                if (title.includes('solana') || title.includes('sol')) {
                    if (!seriesByTag['SOL'].includes(ticker)) seriesByTag['SOL'].push(ticker);
                }
                if (title.includes('doge')) {
                    if (!seriesByTag['Dogecoin'].includes(ticker)) seriesByTag['Dogecoin'].push(ticker);
                }
                if (title.includes('shiba') || title.includes('shib')) {
                    if (!seriesByTag['SHIBA'].includes(ticker)) seriesByTag['SHIBA'].push(ticker);
                }
                if (title.includes('token') || title.includes('airdrop') || title.includes('launch')) {
                    if (!seriesByTag['Pre-Market'].includes(ticker)) seriesByTag['Pre-Market'].push(ticker);
                }
                
                // Map by frequency
                const freq = s.frequency || '';
                if (freq === 'hourly') {
                    seriesByFrequency['hourly'].push(ticker);
                    if (!seriesByTag['Hourly'].includes(ticker)) seriesByTag['Hourly'].push(ticker);
                }
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
                tags: ['All', 'BTC', 'ETH', 'SOL', 'Dogecoin', 'SHIBA', 'Hourly', 'Pre-Market'],
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
    });

