/**
 * Shared crypto filtering logic
 * Used by both the API endpoint and Inngest scheduled jobs
 */

export interface CoinGeckoMarketData {
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

// List of known stablecoins
export const STABLECOINS = [
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

// Wrapped and staked versions of assets (derivatives)
export const WRAPPED_STAKED_ASSETS = [
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
export const EXCLUDED_ASSETS = [...STABLECOINS, ...WRAPPED_STAKED_ASSETS];

/**
 * Pattern-based filter for stablecoins
 */
export const isStablecoin = (coin: CoinGeckoMarketData): boolean => {
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

/**
 * Filter for derivative/wrapped/staked assets by name and symbol
 */
export const isDerivativeAsset = (coin: CoinGeckoMarketData): boolean => {
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

/**
 * Apply all filters and assign volume ranks to coins
 * @param data - Raw CoinGecko market data (should already be sorted by volume)
 * @returns Filtered and ranked data
 */
export const filterAndRankCryptos = (data: CoinGeckoMarketData[]): CoinGeckoMarketData[] => {
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

    // Filter out stablecoins, wrapped and staked assets
    const filteredData = data.filter(coin =>
        !EXCLUDED_ASSETS.includes(coin.id) &&
        !isStablecoin(coin) &&
        !isDerivativeAsset(coin)
    );

    return filteredData;
};

/**
 * Get filtering statistics for logging/debugging
 */
export const getFilteringStats = (data: CoinGeckoMarketData[]): {
    total: number;
    excludedByList: number;
    excludedByStablecoin: number;
    excludedByDerivative: number;
    final: number;
} => {
    const excludedByList = data.filter(coin => EXCLUDED_ASSETS.includes(coin.id));
    const excludedByStablecoin = data.filter(coin => !EXCLUDED_ASSETS.includes(coin.id) && isStablecoin(coin));
    const excludedByDerivative = data.filter(coin => !EXCLUDED_ASSETS.includes(coin.id) && !isStablecoin(coin) && isDerivativeAsset(coin));
    const filteredData = filterAndRankCryptos(data);

    return {
        total: data.length,
        excludedByList: excludedByList.length,
        excludedByStablecoin: excludedByStablecoin.length,
        excludedByDerivative: excludedByDerivative.length,
        final: filteredData.length,
    };
};











