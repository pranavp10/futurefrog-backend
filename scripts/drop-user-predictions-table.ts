import { db } from "../src/db";
import { sql } from "drizzle-orm";

async function dropTable() {
    try {
        console.log("Dropping user_predictions_snapshots table...");
        await db.execute(sql`DROP TABLE IF EXISTS user_predictions_snapshots CASCADE`);
        console.log("✅ Table dropped successfully!");
    } catch (error) {
        console.error("❌ Error dropping table:", error);
    }
    process.exit(0);
}

dropTable();



