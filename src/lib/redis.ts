import Redis from 'ioredis';

// Redis client for caching
// Uses REDIS_URL from environment, defaults to localhost:6379
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true, // Only connect when first command is executed
});

// Log connection status
redis.on('connect', () => {
    console.log('📡 Redis connected');
});

redis.on('error', (err) => {
    console.error('❌ Redis error:', err.message);
});

// Cache TTL in seconds (2 minutes)
export const SENTIMENT_CACHE_TTL = 120;

// Cache key for sentiment predictions
export const SENTIMENT_CACHE_KEY = 'sentiment:predictions';
