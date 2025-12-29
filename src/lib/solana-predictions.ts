import { Connection, PublicKey } from '@solana/web3.js';

// Program constants (from the smart contract)
const PROGRAM_ID = new PublicKey('GGw3GTVpjwLhHdsK4dY3Kb1Lb3vpz5Ns6zV3aMWcf9xe');
const USER_PREDICTIONS_SEED = 'user_predictions';

// Account size: 724 bytes (from lib.rs)
const ACCOUNT_SIZE = 724;

/**
 * User predictions data structure from blockchain
 * Matches the on-chain UserPredictions struct
 */
export interface UserPredictions {
    owner: PublicKey;
    topPerformer: string[];              // 5 x 32-byte strings (CoinGecko IDs)
    worstPerformer: string[];            // 5 x 32-byte strings (CoinGecko IDs)
    topPerformerTimestamps: number[];    // 5 x i64
    worstPerformerTimestamps: number[];  // 5 x i64
    topPerformerPercentages: number[];   // 5 x i16
    worstPerformerPercentages: number[]; // 5 x i16
    topPerformerPrices: number[];        // 5 x u64 (price at prediction, 9 decimals)
    worstPerformerPrices: number[];      // 5 x u64 (price at prediction, 9 decimals)
    topPerformerResolutionPrices: number[];  // 5 x u64 (resolution price, 0 = unresolved)
    worstPerformerResolutionPrices: number[]; // 5 x u64 (resolution price, 0 = unresolved)
    topPerformerDurations: number[];     // 5 x i64 (duration in seconds)
    worstPerformerDurations: number[];   // 5 x i64 (duration in seconds)
    predictionCount: number;             // u64
    points: number;                      // u64
    lastUpdated: number;                 // i64
}

/**
 * Simplified user data for listing
 */
export interface UserListData {
    pubkey: PublicKey;
    points: number;
    lastUpdated: number;
}

/**
 * Helper function to parse fixed-length strings from blockchain data (32 bytes)
 */
function parseFixedString32(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes).trim();
}

/**
 * Derive the PDA for a user's predictions account
 */
export function getUserPredictionsPda(userPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from(USER_PREDICTIONS_SEED), userPubkey.toBuffer()],
        PROGRAM_ID
    );
}

/**
 * Fetch all initialized user accounts from the program
 * Returns basic user data (pubkey, points, lastUpdated)
 */
export async function getAllInitializedUsers(
    connection: Connection
): Promise<UserListData[]> {
    try {
        // Account size: 724 bytes (from lib.rs)
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
            filters: [
                {
                    dataSize: ACCOUNT_SIZE,
                },
            ],
        });

        const users = accounts
            .map((account) => {
                try {
                    const data = account.account.data;

                    // Parse with fixed-length layout
                    const owner = new PublicKey(data.slice(8, 40));

                    // Calculate offset to points/lastUpdated at end of struct
                    // Layout: discriminator(8) + owner(32) + strings(320) + timestamps(80) + percentages(20) + 
                    //         prices(80) + resolution_prices(80) + durations(80) + prediction_count(8) + points(8) + last_updated(8)
                    const offsetToPredictionCount = 8 + 32 + 320 + 80 + 20 + 80 + 80 + 80;
                    const predictionCount = Number(data.readBigUInt64LE(offsetToPredictionCount));
                    const points = Number(data.readBigUInt64LE(offsetToPredictionCount + 8));
                    const lastUpdated = Number(data.readBigInt64LE(offsetToPredictionCount + 16));

                    return {
                        pubkey: owner,
                        points,
                        lastUpdated,
                    };
                } catch (err) {
                    console.error('Error parsing account:', err);
                    return null;
                }
            })
            .filter((user): user is UserListData => user !== null);

        return users;
    } catch (error) {
        console.error('Error fetching all users:', error);
        return [];
    }
}

/**
 * Fetch detailed predictions for a specific user
 */
export async function fetchUserPredictions(
    connection: Connection,
    userPubkey: PublicKey
): Promise<UserPredictions | null> {
    try {
        const [userPredictionsPda] = getUserPredictionsPda(userPubkey);
        const accountInfo = await connection.getAccountInfo(userPredictionsPda);

        if (!accountInfo || accountInfo.data.length === 0) {
            return null;
        }

        const data = accountInfo.data;

        // Parse account data with fixed-length layout (724 bytes total)
        // Layout: discriminator(8) + owner(32) + top_performer(32*5) + worst_performer(32*5) + 
        //         top_performer_timestamps(8*5) + worst_performer_timestamps(8*5) + 
        //         top_performer_percentages(2*5) + worst_performer_percentages(2*5) +
        //         top_performer_prices(8*5) + worst_performer_prices(8*5) +
        //         top_performer_resolution_prices(8*5) + worst_performer_resolution_prices(8*5) +
        //         top_performer_durations(8*5) + worst_performer_durations(8*5) +
        //         prediction_count(8) + points(8) + last_updated(8)
        const owner = new PublicKey(data.slice(8, 40));

        let offset = 40;

        // Read top_performer array (5 fixed 32-byte strings - CoinGecko IDs)
        const topPerformer: string[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformer.push(parseFixedString32(data.slice(offset, offset + 32)));
            offset += 32;
        }

        // Read worst_performer array (5 fixed 32-byte strings - CoinGecko IDs)
        const worstPerformer: string[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformer.push(parseFixedString32(data.slice(offset, offset + 32)));
            offset += 32;
        }

        // Read top_performer_timestamps array (5 i64 timestamps)
        const topPerformerTimestamps: number[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformerTimestamps.push(Number(data.readBigInt64LE(offset)));
            offset += 8;
        }

        // Read worst_performer_timestamps array (5 i64 timestamps)
        const worstPerformerTimestamps: number[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformerTimestamps.push(Number(data.readBigInt64LE(offset)));
            offset += 8;
        }

        // Read top_performer_percentages array (5 i16 percentages)
        const topPerformerPercentages: number[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformerPercentages.push(data.readInt16LE(offset));
            offset += 2;
        }

        // Read worst_performer_percentages array (5 i16 percentages)
        const worstPerformerPercentages: number[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformerPercentages.push(data.readInt16LE(offset));
            offset += 2;
        }

        // Read top_performer_prices array (5 u64 prices)
        const topPerformerPrices: number[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformerPrices.push(Number(data.readBigUInt64LE(offset)));
            offset += 8;
        }

        // Read worst_performer_prices array (5 u64 prices)
        const worstPerformerPrices: number[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformerPrices.push(Number(data.readBigUInt64LE(offset)));
            offset += 8;
        }

        // Read top_performer_resolution_prices array (5 u64 prices - 0 = unresolved)
        const topPerformerResolutionPrices: number[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformerResolutionPrices.push(Number(data.readBigUInt64LE(offset)));
            offset += 8;
        }

        // Read worst_performer_resolution_prices array (5 u64 prices - 0 = unresolved)
        const worstPerformerResolutionPrices: number[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformerResolutionPrices.push(Number(data.readBigUInt64LE(offset)));
            offset += 8;
        }

        // Read top_performer_durations array (5 i64 durations in seconds)
        const topPerformerDurations: number[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformerDurations.push(Number(data.readBigInt64LE(offset)));
            offset += 8;
        }

        // Read worst_performer_durations array (5 i64 durations in seconds)
        const worstPerformerDurations: number[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformerDurations.push(Number(data.readBigInt64LE(offset)));
            offset += 8;
        }

        const predictionCount = Number(data.readBigUInt64LE(offset));
        const points = Number(data.readBigUInt64LE(offset + 8));
        const lastUpdated = Number(data.readBigInt64LE(offset + 16));

        return {
            owner,
            topPerformer,
            worstPerformer,
            topPerformerTimestamps,
            worstPerformerTimestamps,
            topPerformerPercentages,
            worstPerformerPercentages,
            topPerformerPrices,
            worstPerformerPrices,
            topPerformerResolutionPrices,
            worstPerformerResolutionPrices,
            topPerformerDurations,
            worstPerformerDurations,
            predictionCount,
            points,
            lastUpdated,
        };
    } catch (error) {
        console.error(`Error fetching user predictions for ${userPubkey.toBase58()}:`, error);
        return null;
    }
}

/**
 * Fetch all users and their complete predictions
 * This is the main function used by the Inngest job
 */
export async function fetchAllUserPredictions(
    connection: Connection
): Promise<Array<{ userAddress: string; predictions: UserPredictions }>> {
    console.log('   📡 Fetching all initialized users from blockchain...');
    
    const allUsers = await getAllInitializedUsers(connection);
    console.log(`   👥 Found ${allUsers.length} initialized users`);

    if (allUsers.length === 0) {
        return [];
    }

    // Fetch detailed predictions for each user
    const usersWithPredictions = await Promise.all(
        allUsers.map(async (user) => {
            try {
                const predictions = await fetchUserPredictions(connection, user.pubkey);
                if (!predictions) {
                    return null;
                }
                return {
                    userAddress: user.pubkey.toBase58(),
                    predictions,
                };
            } catch (err) {
                console.error(`   ⚠️  Error fetching predictions for ${user.pubkey.toBase58()}:`, err);
                return null;
            }
        })
    );

    // Filter out any nulls
    const validPredictions = usersWithPredictions.filter(
        (item): item is { userAddress: string; predictions: UserPredictions } => item !== null
    );

    console.log(`   ✅ Successfully fetched predictions for ${validPredictions.length} users`);

    return validPredictions;
}
