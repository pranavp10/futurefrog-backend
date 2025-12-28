import { Elysia, t } from "elysia";
import { db } from "../db";
import { userPredictionsSnapshots } from "../db/schema";
import { eq, desc, and } from "drizzle-orm";
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
    .get("/:walletAddress/current", async ({ params }) => {
        const { walletAddress } = params;

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
            
            // Parse blockchain data - updated for 32-byte CoinGecko IDs
            let offset = 40; // Skip discriminator(8) + owner(32)
            
            // Read top_performer array (5 fixed 32-byte strings - CoinGecko IDs)
            const topPerformerIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                topPerformerIds.push(parseFixedString(data.slice(offset, offset + 32)));
                offset += 32;
            }
            
            // Read worst_performer array (5 fixed 32-byte strings - CoinGecko IDs)
            const worstPerformerIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                worstPerformerIds.push(parseFixedString(data.slice(offset, offset + 32)));
                offset += 32;
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
            
            // Read percentages (5 i16 values each for top and worst)
            const topPerformerPercentages: number[] = [];
            for (let i = 0; i < 5; i++) {
                topPerformerPercentages.push(data.readInt16LE(offset));
                offset += 2;
            }
            
            const worstPerformerPercentages: number[] = [];
            for (let i = 0; i < 5; i++) {
                worstPerformerPercentages.push(data.readInt16LE(offset));
                offset += 2;
            }
            
            // Read prices (5 u64 values each for top and worst)
            const topPerformerPrices: number[] = [];
            for (let i = 0; i < 5; i++) {
                const price = data.readBigUInt64LE(offset);
                topPerformerPrices.push(Number(price) / 1_000_000_000); // Convert from 9 decimals
                offset += 8;
            }
            
            const worstPerformerPrices: number[] = [];
            for (let i = 0; i < 5; i++) {
                const price = data.readBigUInt64LE(offset);
                worstPerformerPrices.push(Number(price) / 1_000_000_000);
                offset += 8;
            }
            
            // Skip resolution prices (5 u64 each for top and worst)
            offset += 8 * 5; // top_performer_resolution_prices
            offset += 8 * 5; // worst_performer_resolution_prices
            
            // Read durations (5 i64 each for top and worst)
            const topPerformerDurations: number[] = [];
            for (let i = 0; i < 5; i++) {
                topPerformerDurations.push(Number(data.readBigInt64LE(offset)));
                offset += 8;
            }
            
            const worstPerformerDurations: number[] = [];
            for (let i = 0; i < 5; i++) {
                worstPerformerDurations.push(Number(data.readBigInt64LE(offset)));
                offset += 8;
            }
            
            // Read prediction_count
            const predictionCount = Number(data.readBigUInt64LE(offset));
            offset += 8;
            
            // Read points and last_updated
            const points = Number(data.readBigUInt64LE(offset));
            offset += 8;
            const lastUpdated = Number(data.readBigInt64LE(offset));

            // Helper function to build prediction object
            // CoinGecko ID is stored directly on-chain, no mapping needed
            const buildPrediction = (coingeckoId: string, timestamp: number, rank: number, percentage: number, priceAtPrediction: number, duration: number) => {
                const cleanId = coingeckoId.trim();
                return {
                    rank,
                    coingeckoId: cleanId,
                    timestamp,
                    percentage,
                    priceAtPrediction: priceAtPrediction > 0 ? priceAtPrediction : null,
                    duration,
                    pointsEarned: 0,
                    processed: false,
                };
            };

            // Build all predictions (prices are already stored on-chain, no need to fetch)
            const topPerformers = topPerformerIds.map((id, index) => 
                buildPrediction(
                    id, 
                    topPerformerTimestamps[index], 
                    index,
                    topPerformerPercentages[index],
                    topPerformerPrices[index],
                    topPerformerDurations[index]
                )
            );
            
            const worstPerformers = worstPerformerIds.map((id, index) => 
                buildPrediction(
                    id, 
                    worstPerformerTimestamps[index], 
                    index,
                    worstPerformerPercentages[index],
                    worstPerformerPrices[index],
                    worstPerformerDurations[index]
                )
            );

            return {
                walletAddress,
                topPerformers,
                worstPerformers,
                points,
                predictionCount,
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
        })
    })

    // Get prediction history for a user (all snapshots)
    .get("/:walletAddress/history", async ({ params, query }) => {
        const { walletAddress } = params;
        const limit = query.limit ? parseInt(query.limit) : 50;
        const offset = query.offset ? parseInt(query.offset) : 0;

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

        // Helper function to format prediction from database
        // The symbol field in DB actually stores the CoinGecko ID now
        const formatPrediction = (p: typeof snapshots[0]) => {
            return {
                rank: p.rank,
                coingeckoId: p.symbol || '', // symbol field stores CoinGecko ID
                timestamp: p.predictionTimestamp,
                predictedPercentage: p.predictedPercentage,
                actualPercentage: p.actualPercentage,
                priceAtScoring: p.priceAtScoring,
                pointsEarned: p.pointsEarned || 0,
                processed: p.processed,
            };
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

                // Format all predictions
                const topPerformers = topPerformersSnapshots.map(formatPrediction);
                const worstPerformers = worstPerformersSnapshots.map(formatPrediction);

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
            offset: t.Optional(t.String())
        })
    })

    // Get resolved predictions for a user (from database)
    .get("/:walletAddress/resolved", async ({ params, query }) => {
        const { walletAddress } = params;
        const limit = query.limit ? parseInt(query.limit) : 50;
        const offset = query.offset ? parseInt(query.offset) : 0;

        // Get all resolved predictions for this user
        // Resolved = processed is true AND solanaSignature exists AND resolvedAt exists
        const resolved = await db
            .select()
            .from(userPredictionsSnapshots)
            .where(
                and(
                    eq(userPredictionsSnapshots.walletAddress, walletAddress),
                    eq(userPredictionsSnapshots.processed, true)
                )
            )
            .orderBy(desc(userPredictionsSnapshots.resolvedAt))
            .limit(limit)
            .offset(offset);

        // Filter to only those with resolvedAt (fully resolved predictions)
        const fullyResolved = resolved.filter(p => p.resolvedAt !== null);

        // Format the predictions
        const predictions = fullyResolved.map(p => ({
            id: p.id,
            predictionType: p.predictionType,
            rank: p.rank,
            symbol: p.symbol,
            predictedPercentage: p.predictedPercentage,
            actualPercentage: p.actualPercentage ? parseFloat(p.actualPercentage) : null,
            priceAtPrediction: p.priceAtPrediction ? parseFloat(p.priceAtPrediction) : null,
            priceAtResolution: p.priceAtScoring ? parseFloat(p.priceAtScoring) : null,
            duration: p.duration,
            predictionTimestamp: p.predictionTimestamp,
            resolutionTime: p.resolutionTime?.toISOString() || null,
            resolvedAt: p.resolvedAt?.toISOString() || null,
            resolvedBy: p.resolvedBy,
            pointsEarned: p.pointsEarned || 0,
            solanaSignature: p.solanaSignature,
        }));

        return {
            walletAddress,
            predictions,
            total: predictions.length,
            limit,
            offset,
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        }),
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String())
        })
    })

    // Get performance stats for a user (accuracy-based scoring)
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
        
        // Calculate stats by accuracy tier (new scoring system)
        const perfectPredictions = predictions.filter(p => p.pointsEarned === 1000).length;
        const excellentPredictions = predictions.filter(p => p.pointsEarned === 750).length;
        const greatPredictions = predictions.filter(p => p.pointsEarned === 500).length;
        const goodPredictions = predictions.filter(p => p.pointsEarned === 250).length;
        const fairPredictions = predictions.filter(p => p.pointsEarned === 100).length;
        const correctDirectionPredictions = predictions.filter(p => p.pointsEarned === 50).length;
        const wrongDirectionPredictions = predictions.filter(p => p.pointsEarned === 10).length;
        
        // Correct direction = any prediction that got direction right (not 10 points)
        const correctDirectionTotal = predictions.filter(p => (p.pointsEarned || 0) > 10).length;

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
            // Accuracy tiers breakdown
            accuracyTiers: {
                perfect: perfectPredictions,      // 1000 pts (0-1% error)
                excellent: excellentPredictions,  // 750 pts (1-2% error)
                great: greatPredictions,          // 500 pts (2-5% error)
                good: goodPredictions,            // 250 pts (5-10% error)
                fair: fairPredictions,            // 100 pts (10-20% error)
                correctDirection: correctDirectionPredictions, // 50 pts (>20% error but right direction)
                wrongDirection: wrongDirectionPredictions,     // 10 pts (wrong direction)
            },
            // Overall accuracy (predictions with correct direction)
            correctDirectionTotal,
            directionAccuracy: totalPredictions > 0 
                ? ((correctDirectionTotal / totalPredictions) * 100).toFixed(2) 
                : '0.00',
            // Average points per prediction
            averagePoints: totalPredictions > 0 
                ? (totalPointsEarned / totalPredictions).toFixed(2) 
                : '0.00',
        };
    }, {
        params: t.Object({
            walletAddress: t.String()
        })
    });
