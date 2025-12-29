import Redis from 'ioredis';

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

// AI Predictions cache TTL in seconds (5 minutes)
export const AI_PREDICTIONS_CACHE_TTL = 300;

// Cache key prefix for AI predictions
export const AI_PREDICTIONS_CACHE_PREFIX = 'ai-predictions:onchain:';
