import { Connection, PublicKey } from '@solana/web3.js';

// Program constants (from the smart contract)
const PROGRAM_ID = new PublicKey('2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM');
const USER_PREDICTIONS_SEED = 'user_predictions';

/**
 * User predictions data structure from blockchain
 */
export interface UserPredictions {
    owner: PublicKey;
    topPerformer: string[];
    worstPerformer: string[];
    topPerformerTimestamps: number[];
    worstPerformerTimestamps: number[];
    points: number;
    lastUpdated: number;
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
 * Helper function to parse fixed-length strings from blockchain data
 */
function parseFixedString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes).trimEnd();
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
        // Fixed size: 8 + 32 + 6*5 + 6*5 + 8*5 + 8*5 + 8 + 8 = 196 bytes
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
            filters: [
                {
                    dataSize: 196,
                },
            ],
        });

        const users = accounts
            .map((account) => {
                try {
                    const data = account.account.data;

                    // Parse with fixed-length layout
                    const owner = new PublicKey(data.slice(8, 40));

                    // Skip the string arrays (30 bytes for top_performer + 30 bytes for worst_performer)
                    // Skip the timestamp arrays (40 bytes for top_performer_timestamps + 40 bytes for worst_performer_timestamps)
                    const offset = 40 + 30 + 30 + 40 + 40;

                    const points = Number(data.readBigUInt64LE(offset));
                    const lastUpdated = Number(data.readBigInt64LE(offset + 8));

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

        // Parse account data with fixed-length layout
        // Layout: discriminator(8) + owner(32) + top_performer(6*5) + worst_performer(6*5) + top_performer_timestamps(8*5) + worst_performer_timestamps(8*5) + points(8) + last_updated(8)
        const owner = new PublicKey(data.slice(8, 40));

        let offset = 40;

        // Read top_performer array (5 fixed 6-byte strings)
        const topPerformer: string[] = [];
        for (let i = 0; i < 5; i++) {
            topPerformer.push(parseFixedString(data.slice(offset, offset + 6)));
            offset += 6;
        }

        // Read worst_performer array (5 fixed 6-byte strings)
        const worstPerformer: string[] = [];
        for (let i = 0; i < 5; i++) {
            worstPerformer.push(parseFixedString(data.slice(offset, offset + 6)));
            offset += 6;
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

        const points = Number(data.readBigUInt64LE(offset));
        const lastUpdated = Number(data.readBigInt64LE(offset + 8));

        return {
            owner,
            topPerformer,
            worstPerformer,
            topPerformerTimestamps,
            worstPerformerTimestamps,
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
