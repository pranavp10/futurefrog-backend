import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { cryptoMarketCache, cryptoPriceHistory } from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema: { cryptoMarketCache, cryptoPriceHistory } });
