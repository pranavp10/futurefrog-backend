import { Elysia, t } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots } from "../db/schema";
import { eq, desc, and, isNotNull, isNull } from "drizzle-orm";
import { getCoingeckoIdFromSymbol } from "../lib/redis";
import { getHistoricalPrice } from "../lib/historical-price";
import { Connection, PublicKey } from "@solana/web3.js";

// Helper to get PDA address
function getUserPredictionsPda(userPubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("user_predictions"), userPubkey.toBuffer()],
        programId
    );
}

// Helper to parse fixed-length string from buffer
function parseFixedString(buffer: Buffer): string {
    const nullIndex = buffer.indexOf(0);
    return nullIndex === -1 
        ? buffer.toString('utf-8') 
        : buffer.slice(0, nullIndex).toString('utf-8');
}

export const userPredictionsRoutes = new Elysia({ prefix: "/user-predictions" })
    // Get current predictions for a user (from blockchain with prices)
    .get("/:walletAddress/current", async ({ params, query }) => {
        const { walletAddress } = params;
        const includePrices = query.includePrices !== 'false'; // default true

        try {
            // Fetch current predictions from blockchain
            const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            const programId = new PublicKey(process.env.PROGRAM_ID || '5jj4LioBtbZw1jHgz8PREYzDYZqNS7JPUM3oY7qCC18C');
            const connection = new Connection(rpcUrl, 'confirmed');
            const userPubkey = new PublicKey(walletAddress);
            
            const [userPredictionsPda] = getUserPredictionsPda(userPubkey, programId);
            const accountInfo = await connection.getAccountInfo(userPredictionsPda);

            if (!accountInfo || accountInfo.data.length === 0) {
                return {
                    walletAddress,
                    topPerformers: [],
                    worstPerformers: [],
                    points: 0,
                    lastUpdated: null,
                    snapshotTimestamp: null,
                };
            }

            const data = accountInfo.data;
            
            // Parse blockchain data
            let offset = 40; // Skip discriminator(8) + owner(32)
            
            // Read top_performer array (5 fixed 6-byte strings)
            const topPerformerSymbols: string[] = [];
            for (let i = 0; i < 5; i++) {
                topPerformerSymbols.push(parseFixedString(data.slice(offset, offset + 6)));
                offset += 6;
            }
            
            // Read worst_performer array (5 fixed 6-byte strings)
            const worstPerformerSymbols: string[] = [];
            for (let i = 0; i < 5; i++) {
                worstPerformerSymbols.push(parseFixedString(data.slice(offset, offset + 6)));
                offset += 6;
            }
            
            // Read top_performer_timestamps (5 i64 values)
            const topPerformerTimestamps: number[] = [];
            for (let i = 0; i < 5; i++) {
                const timestamp = data.readBigInt64LE(offset);
                topPerformerTimestamps.push(Number(timestamp));
                offset += 8;
            }
            
            // Read worst_performer_timestamps (5 i64 values)
            const worstPerformerTimestamps: number[] = [];
            for (let i = 0; i < 5; i++) {
                const timestamp = data.readBigInt64LE(offset);
                worstPerformerTimestamps.push(Number(timestamp));
                offset += 8;
            }
            
            // Skip percentages (5 u16 values each for top and worst)
            offset += 2 * 5; // top_performer_percentages
            offset += 2 * 5; // worst_performer_percentages
            
            // Read points and last_updated
            const points = Number(data.readBigInt64LE(offset));
            offset += 8;
            const lastUpdated = Number(data.readBigInt64LE(offset));

            // Helper function to enrich prediction with price
            const enrichPrediction = async (symbol: string, timestamp: number, rank: number) => {
                const cleanSymbol = symbol.trim();
                const prediction = {
                    rank,
                    symbol: cleanSymbol,
                    timestamp,
                    pointsEarned: 0,
                    processed: false,
                    priceAtPrediction: null as number | null,
                };

                if (includePrices && cleanSymbol !== '' && timestamp > 0) {
                    try {
                        const coingeckoId = await getCoingeckoIdFromSymbol(cleanSymbol);
                        if (coingeckoId) {
                            const price = await getHistoricalPrice(coingeckoId, timestamp);
                            prediction.priceAtPrediction = price;
                        } else {
                            console.warn(`⚠️ No CoinGecko ID for symbol: ${cleanSymbol}`);
                        }
                    } catch (error) {
                        console.error(`❌ Error fetching price for ${cleanSymbol}:`, error);
                    }
                }

                return prediction;
            };

            // Enrich all predictions in parallel
            const topPerformersPromises = topPerformerSymbols.map((symbol, index) => 
                enrichPrediction(symbol, topPerformerTimestamps[index], index)
            );
            
            const worstPerformersPromises = worstPerformerSymbols.map((symbol, index) => 
                enrichPrediction(symbol, worstPerformerTimestamps[index], index)
            );

            const [topPerformers, worstPerformers] = await Promise.all([
                Promise.all(topPerformersPromises),
                Promise.all(worstPerformersPromises),
            ]);

            return {
                walletAddress,
                topPerformers,
                worstPerformers,
                points,
                lastUpdated,
                snapshotTimestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error fetching blockchain predictions:', error);
            // Fallback: return empty if blockchain fetch fails
            return {
                walletAddress,
                topPerformers: [],
                worstPerformers: [],
                points: 0,
                lastUpdated: null,
                snapshotTimestamp: null,
            };
        }
    }, {
        params: t.Object({
            walletAddress: t.String()
        }),
        query: t.Object({
            includePrices: t.Optional(t.String())
        })
    })

    // Get prediction history for a user (all snapshots)
    .get("/:walletAddress/history", async ({ params, query }) => {
        const { walletAddress } = params;
        const limit = query.limit ? parseInt(query.limit) : 50;
        const offset = query.offset ? parseInt(query.offset) : 0;
        const includePrices = query.includePrices !== 'false'; // default true

        // Get all snapshots for this user, grouped by snapshot timestamp
        const snapshots = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(eq(userPredictionsSnapshots.walletAddress, walletAddress))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(limit)
            .offset(offset);

        // Group predictions by snapshot timestamp
        const groupedBySnapshot = new Map<string, typeof snapshots>();
        
        for (const snapshot of snapshots) {
            const key = snapshot.snapshotTimestamp.toISOString();
            if (!groupedBySnapshot.has(key)) {
                groupedBySnapshot.set(key, []);
            }
            groupedBySnapshot.get(key)!.push(snapshot);
        }

        // Helper function to enrich prediction with price
        const enrichPrediction = async (p: typeof snapshots[0]) => {
            const prediction = {
                rank: p.rank,
                symbol: p.symbol || '',
                timestamp: p.predictionTimestamp,
                pointsEarned: p.pointsEarned || 0,
                processed: p.processed,
                priceAtPrediction: null as number | null,
            };

            if (includePrices && p.symbol && p.predictionTimestamp) {
                try {
                    const coingeckoId = await getCoingeckoIdFromSymbol(p.symbol);
                    if (coingeckoId) {
                        const price = await getHistoricalPrice(coingeckoId, p.predictionTimestamp);
                        prediction.priceAtPrediction = price;
                    }
                } catch (error) {
                    console.error(`❌ Error fetching price for ${p.symbol}:`, error);
                }
            }

            return prediction;
        };

        // Format the grouped snapshots with prices
        const history = await Promise.all(
            Array.from(groupedBySnapshot.entries()).map(async ([timestamp, predictions]) => {
                const topPerformersSnapshots = predictions
                    .filter(p => p.predictionType === 'top_performer')
                    .sort((a, b) => a.rank - b.rank);

                const worstPerformersSnapshots = predictions
                    .filter(p => p.predictionType === 'worst_performer')
                    .sort((a, b) => a.rank - b.rank);

                // Enrich all predictions in parallel
                const [topPerformers, worstPerformers] = await Promise.all([
                    Promise.all(topPerformersSnapshots.map(enrichPrediction)),
                    Promise.all(worstPerformersSnapshots.map(enrichPrediction)),
                ]);

                return {
                    snapshotTimestamp: timestamp,
                    points: predictions[0]?.points || 0,
                    lastUpdated: predictions[0]?.lastUpdated || null,
                    topPerformers,
                    worstPerformers,
                    totalPredictions: predictions.length,
                };
            })
        );

        return {
            walletAddress,
            history,
            total: history.length,
            limit,
            offset,
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        }),
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            includePrices: t.Optional(t.String())
        })
    })

    // Get performance stats for a user
    .get("/:walletAddress/stats", async ({ params }) => {
        const { walletAddress } = params;

        // Get all processed predictions
        const predictions = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(and(
                eq(userPredictionsSnapshots.walletAddress, walletAddress),
                eq(userPredictionsSnapshots.processed, true)
            ));

        const totalPredictions = predictions.length;
        const totalPointsEarned = predictions.reduce((sum, p) => sum + (p.pointsEarned || 0), 0);
        
        // Calculate correct predictions (earned more than participation points)
        const correctPredictions = predictions.filter(p => (p.pointsEarned || 0) > 1).length;
        const exactMatches = predictions.filter(p => p.pointsEarned === 50).length;
        const categoryMatches = predictions.filter(p => p.pointsEarned === 10).length;

        // Get current points from latest snapshot
        const latest = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(eq(userPredictionsSnapshots.walletAddress, walletAddress))
            .orderBy(desc(userPredictionsSnapshots.snapshotTimestamp))
            .limit(1);

        const currentPoints = latest[0]?.points || 0;

        return {
            walletAddress,
            currentPoints,
            totalPredictions,
            totalPointsEarned,
            correctPredictions,
            exactMatches,
            categoryMatches,
            accuracy: totalPredictions > 0 ? (correctPredictions / totalPredictions * 100).toFixed(2) : '0.00',
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        })
    });
