import { Elysia } from "elysia";
import { db } from "../db";
import { coins } from "../db/schema";

export const getCoinsRoute = new Elysia().get("/coins", async () => {
    try {
        const allCoins = await db.select().from(coins);

        return {
            success: true,
            data: allCoins,
            count: allCoins.length,
        };
    } catch (error) {
        console.error("Error fetching coins:", error);
        return {
            success: false,
            error: "Failed to fetch coins",
        };
    }
});
