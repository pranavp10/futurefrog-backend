import Redis from 'ioredis';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Create Redis client singleton
let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
    if (!redisClient) {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) {
                    console.error('❌ Redis connection failed after 3 retries');
                    return null;
                }
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        redisClient.on('connect', () => {
            console.log('✅ Redis connected successfully');
        });

        redisClient.on('error', (err) => {
            console.error('❌ Redis error:', err.message);
        });
    }
    return redisClient;
}

// Legacy export for backward compatibility
export const redis = getRedisClient();

// Close Redis connection (for graceful shutdown)
export async function closeRedis(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}

// Cache TTL in seconds (2 minutes)
export const SENTIMENT_CACHE_TTL = 120;

// Cache key for sentiment predictions
export const SENTIMENT_CACHE_KEY = 'sentiment:predictions';

// Symbol to CoinGecko ID mapping service
const SYMBOL_MAP_PREFIX = 'symbol:map:';
const SYMBOL_MAP_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

interface CoinMapping {
    id: string;
    symbol: string;
    name: string;
}

/**
 * Load symbol mappings from the JSON file and live CoinGecko API into Redis
 * This should be called on application startup
 */
export async function loadSymbolMappings(): Promise<void> {
    try {
        const redis = getRedisClient();
        const pipeline = redis.pipeline();
        let count = 0;

        // First, try to load from the JSON file (if available)
        try {
            const filePath = join(process.cwd(), 'long-id-coins-market-caps.json');
            console.log('📊 Loading symbol mappings from:', filePath);
            const fileContent = await readFile(filePath, 'utf-8');
            const data = JSON.parse(fileContent);
            
            if (data.coins && Array.isArray(data.coins)) {
                const coins: CoinMapping[] = data.coins;
                
                // Store each symbol mapping in Redis
                for (const coin of coins) {
                    if (coin.symbol && coin.id) {
                        const key = `${SYMBOL_MAP_PREFIX}${coin.symbol.toUpperCase()}`;
                        pipeline.setex(key, SYMBOL_MAP_TTL, coin.id);
                        count++;
                    }
                }
            }
        } catch (fileError) {
            console.warn('⚠️ Could not load from JSON file, will try live API:', fileError);
        }

        // Also fetch current top coins from CoinGecko to ensure we have the most recent symbols
        try {
            const apiKey = process.env.COINGECKO_API_KEY;
            const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1${apiKey ? `&x_cg_demo_api_key=${apiKey}` : ''}`;
            
            console.log('📡 Fetching live coin data from CoinGecko for symbol mapping...');
            const response = await fetch(url);
            
            if (response.ok) {
                const liveCoins = await response.json();
                
                for (const coin of liveCoins) {
                    if (coin.symbol && coin.id) {
                        const key = `${SYMBOL_MAP_PREFIX}${coin.symbol.toUpperCase()}`;
                        // Use setex to overwrite any existing mappings with live data
                        pipeline.setex(key, SYMBOL_MAP_TTL, coin.id);
                        count++;
                    }
                }
                console.log(`✅ Added ${liveCoins.length} live coin mappings`);
            }
        } catch (apiError) {
            console.warn('⚠️ Could not fetch live symbols from CoinGecko:', apiError);
        }

        await pipeline.exec();
        console.log(`✅ Total symbol mappings loaded into Redis: ${count}`);
    } catch (error) {
        console.error('❌ Error loading symbol mappings:', error);
        throw error;
    }
}

/**
 * Get CoinGecko ID from a crypto symbol
 * @param symbol - Crypto symbol (e.g., "BTC", "ETH")
 * @returns CoinGecko ID (e.g., "bitcoin", "ethereum") or null if not found
 */
export async function getCoingeckoIdFromSymbol(symbol: string): Promise<string | null> {
    try {
        const redis = getRedisClient();
        const key = `${SYMBOL_MAP_PREFIX}${symbol.toUpperCase()}`;
        const coingeckoId = await redis.get(key);
        
        if (!coingeckoId) {
            console.warn(`⚠️ No CoinGecko ID found for symbol: ${symbol}`);
            return null;
        }
        
        return coingeckoId;
    } catch (error) {
        console.error(`❌ Error getting CoinGecko ID for ${symbol}:`, error);
        return null;
    }
}

/**
 * Check if symbol mappings are loaded in Redis
 * @returns true if mappings exist, false otherwise
 */
export async function areSymbolMappingsLoaded(): Promise<boolean> {
    try {
        const redis = getRedisClient();
        // Check if at least one common symbol exists
        const btcKey = `${SYMBOL_MAP_PREFIX}BTC`;
        const exists = await redis.exists(btcKey);
        return exists === 1;
    } catch (error) {
        console.error('❌ Error checking symbol mappings:', error);
        return false;
    }
}
