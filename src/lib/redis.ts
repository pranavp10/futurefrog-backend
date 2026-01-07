import Redis from 'ioredis';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
    if (!redisClient) {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        redisClient = new Redis(redisUrl);

        redisClient.on('error', (err) => {
            console.error('Redis connection error:', err);
        });

        redisClient.on('connect', () => {
            console.log('Connected to Redis');
        });
    }
    return redisClient;
}

export async function closeRedisClient(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}
