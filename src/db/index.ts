import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Database connection string from environment variable
const connectionString = process.env.DATABASE_URL!;

// Create postgres connection
const client = postgres(connectionString);

// Create drizzle database instance with schema
export const db = drizzle(client, { schema });

// Export schema for use in other files
export { schema };
