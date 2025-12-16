import { Elysia } from 'elysia';

interface CoinGeckoMarketData {
    id: string;
    symbol: string;
    name: string;
    image: string;
    current_price: number;
    market_cap: number;
    market_cap_rank: number;
    total_volume: number;
    price_change_percentage_24h: number;
    volume_rank?: number; // Our custom volume rank
}

const STABLECOINS = [
    'tether',
    'usd-coin',
    'binance-usd',
    'dai',
    'true-usd',
    'paxos-standard',
    'tether-gold',
    'liquity-usd',
    'frax',
    'gemini-dollar',
    'first-digital-usd',
    'ethena-usde',
    'pyusd',
    'usds',
    'ripple-usd',
    'syrupusdt',
    'binance-bridged-usdc-bnb-smart-chain',
    'global-dollar',
    'binance-bridged-usdt-bnb-smart-chain',
    'blackrock-usd-institutional-digital-liquidity-fund',
    'paypal-usd',
    'bfusd',
    'syrupusdc',
    'ethena-staked-usde',
    'usdt0',
    'usd1',
    'circle-usyc',
    'fdusd',
    'maker',
    'usdd',
    'alchemix-usd',
    'usdj',
    'neutrino-usd',
];

// Pattern-based filters for stablecoins and derivatives
const isStablecoin = (coin: CoinGeckoMarketData): boolean => {
    const name = coin.name.toLowerCase();
    const symbol = coin.symbol.toLowerCase();
    const id = coin.id.toLowerCase();

    // Check explicit list first
    if (STABLECOINS.includes(id)) return true;

    // Pattern matching for USD-based stablecoins
    const usdPatterns = [
        /usd/i,              // Contains "usd" anywhere (catches crvUSD, XUSD, etc.)
        /\busdt\b/i,         // USDT
        /\busdc\b/i,         // USDC
        /\busdd\b/i,         // USDD
        /\busde\b/i,         // USDe
        /\busdg\b/i,         // USDG
        /\bfdusd\b/i,        // FDUSD
        /\bbusd\b/i,         // BUSD
        /\btusd\b/i,         // TUSD
        /\bgusd\b/i,         // GUSD
        /\bsusd\b/i,         // SUSD
        /\bpusd\b/i,         // PUSD
        /\bpyusd\b/i,        // PayPal USD
        /\brusd\b/i,         // RUSD (Ripple USD)
        /dollar/i,           // Contains "dollar"
        /stablecoin/i,       // Contains "stablecoin"
    ];

    return usdPatterns.some(pattern =>
        pattern.test(name) || pattern.test(symbol) || pattern.test(id)
    );
};

// Filter for derivative/wrapped/staked assets by name and symbol
const isDerivativeAsset = (coin: CoinGeckoMarketData): boolean => {
    const name = coin.name.toLowerCase();
    const symbol = coin.symbol.toLowerCase();
    const id = coin.id.toLowerCase();

    // Explicit check: never filter native assets
    const nativeAssets = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano', 'avalanche-2', 'polkadot'];
    if (nativeAssets.includes(id)) {
        return false;
    }

    // Keywords that indicate derivative/wrapped/synthetic assets in NAME
    const derivativeKeywords = [
        'wrapped',
        'staked',
        'bridged',
        'pegged',
        'synthetic',
        'liquid staking',
        'restaked',
        'staking',
        'receipt',
        'derivative',
        'mirrored',
        'tokenized',
        'peg',
        '-peg',
        'yield',
        'vault',
        'bridge',
        'liquid',
        'function', // Function FBTC, etc.
        'unit', // Unit Bitcoin, Unit Ethereum, etc.
        'gold', // PAX Gold, UGOLD, Tether Gold, etc.
    ];

    // Check if name contains any derivative keywords
    if (derivativeKeywords.some(keyword => name.includes(keyword))) {
        return true;
    }

    // Explicit symbol checks for common wrapped versions
    const wrappedSymbols = [
        'wbtc', 'weth', 'wsol', 'wbnb', 'wmatic', 'wavax', 'wftm', 'wada',
        'steth', 'reth', 'cbeth', 'frxeth', 'seth', 'beth',
        'renbtc', 'hbtc', 'tbtc', 'fbtc',
        'stbtc', 'wsteth', 'reth2', 'sfrxeth',
        'ethw', 'btcb', 'ethb', 'sols',
    ];

    if (wrappedSymbols.includes(symbol)) {
        return true;
    }

    // Check for derivative prefixes in symbols
    // wBTC, stETH, cbETH, rETH, etc.
    const derivativePrefixes = ['w', 'st', 'cb', 'r', 'f', 'a', 'c', 's', 'b', 'ls', 'rs'];
    const knownBaseSymbols = ['btc', 'eth', 'sol', 'bnb', 'matic', 'avax', 'ftm', 'ada', 'dot', 'atom'];

    for (const base of knownBaseSymbols) {
        for (const prefix of derivativePrefixes) {
            // Check if symbol is like wBTC, stETH, etc (prefix + base)
            if (symbol === `${prefix}${base}`) {
                return true;
            }
        }

        // Also check for suffixes and variations
        // BTCB, ETHW, SOLS, etc.
        const derivativeSuffixes = ['b', 'w', 's', '2', 'x'];
        for (const suffix of derivativeSuffixes) {
            if (symbol === `${base}${suffix}` && symbol !== base) {
                return true;
            }
        }
    }

    return false;
};

// Wrapped and staked versions of assets (derivatives)
const WRAPPED_STAKED_ASSETS = [
    // Wrapped Bitcoin
    'wrapped-bitcoin',
    'renbtc',
    'huobi-btc',
    'bitcoin-bep2',
    'wrapped-btc-wormhole',
    'tbtc',

    // Staked ETH and ETH derivatives
    'steth',
    'lido-staked-ether',
    'wrapped-steth',
    'reth',
    'rocket-pool-eth',
    'staked-frax-ether',
    'coinbase-wrapped-staked-eth',
    'wrapped-eeth',
    'mantle-staked-ether',
    'frax-ether',
    'binance-staked-eth',
    'stakewise-staked-eth',
    'renzo-restaked-eth',

    // Wrapped SOL
    'wrapped-solana',
    'wrapped-sol-wormhole',

    // Wrapped BNB
    'wrapped-bnb',
    'binance-peg-bnb',

    // Wrapped AVAX
    'wrapped-avax',

    // Wrapped MATIC
    'wrapped-matic',
    'staked-matic',

    // Other wrapped assets
    'wrapped-token',
    'wrapped-near',
    'wrapped-fantom',
    'wrapped-rose',
    'wrapped-one',

    // Liquid staking derivatives
    'lido-dao-wsteth',
    'stride-staked-atom',
    'stride-staked-osmo',
    'stride-staked-stars',
];

// Combined exclusion list
const EXCLUDED_ASSETS = [...STABLECOINS, ...WRAPPED_STAKED_ASSETS];

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
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.statusText}`);
            }

            const data: CoinGeckoMarketData[] = await response.json();

            console.log('📊 Total coins from CoinGecko:', data.length);

            // Assign volume rank based on the order from CoinGecko (already sorted by volume)
            let volumeRank = 1;
            for (const coin of data) {
                // Only assign rank to coins that pass our filters
                if (!EXCLUDED_ASSETS.includes(coin.id) &&
                    !isStablecoin(coin) &&
                    !isDerivativeAsset(coin)) {
                    coin.volume_rank = volumeRank;
                    volumeRank++;
                }
            }

            // Count filtering stats
            const excludedByList = data.filter(coin => EXCLUDED_ASSETS.includes(coin.id));
            const excludedByStablecoin = data.filter(coin => !EXCLUDED_ASSETS.includes(coin.id) && isStablecoin(coin));
            const excludedByDerivative = data.filter(coin => !EXCLUDED_ASSETS.includes(coin.id) && !isStablecoin(coin) && isDerivativeAsset(coin));

            console.log('🚫 Filtered by explicit list:', excludedByList.length);
            console.log('🚫 Filtered as stablecoins:', excludedByStablecoin.length);
            console.log('🚫 Filtered as derivatives:', excludedByDerivative.length);

            // Show some examples of filtered derivatives
            if (excludedByDerivative.length > 0) {
                console.log('   Examples:', excludedByDerivative.slice(0, 5).map(c => `${c.name} (${c.symbol})`).join(', '));
            }

            // Filter out stablecoins, wrapped and staked assets
            const filteredData = data
                .filter(coin =>
                    !EXCLUDED_ASSETS.includes(coin.id) &&
                    !isStablecoin(coin) &&
                    !isDerivativeAsset(coin)
                )
                .slice(0, 100);

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
