import { Elysia } from 'elysia';
import {
    CoinGeckoMarketData,
    filterAndRankCryptos,
    getFilteringStats,
} from '../lib/crypto-filters';

/**
 * Crypto movers routes
 * Fetches top 100 cryptocurrencies by 24h volume (excluding stablecoins, wrapped and staked assets)
 */
export const cryptoMoversRoutes = new Elysia({ prefix: '/api/crypto-movers' })
    .get('/', async ({ set }) => {
        try {
            const apiKey = process.env.COINGECKO_API_KEY;

            // Fetch top 200 by volume to ensure we get 100 after filtering
            const response = await fetch(
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=true&price_change_percentage=24h${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.statusText}`);
            }

            const data: CoinGeckoMarketData[] = await response.json();

            console.log('📊 Total coins from CoinGecko:', data.length);

            // Get filtering statistics
            const stats = getFilteringStats(data);
            console.log('🚫 Filtered by explicit list:', stats.excludedByList);
            console.log('🚫 Filtered as stablecoins:', stats.excludedByStablecoin);
            console.log('🚫 Filtered as derivatives:', stats.excludedByDerivative);

            // Apply filters and ranking
            const filteredData = filterAndRankCryptos(data).slice(0, 100);

            console.log('✅ Final filtered results:', filteredData.length);

            // Check if ETH and BTC made it
            const ethInFiltered = filteredData.find(c => c.id === 'ethereum');
            const btcInFiltered = filteredData.find(c => c.id === 'bitcoin');
            console.log('   ETH included?', ethInFiltered ? 'YES' : 'NO');
            console.log('   BTC included?', btcInFiltered ? 'YES' : 'NO');

            return {
                success: true,
                data: filteredData,
                count: filteredData.length,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching crypto movers:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch crypto movers',
            };
        }
    });
