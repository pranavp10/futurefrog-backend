# User Predictions Snapshot Feature

## Overview
Extended the crypto snapshot Inngest job to fetch and store user predictions from the Solana blockchain. This feature captures a historical record of all user predictions independently from CoinGecko data snapshots.

## Important Design Principle

**User predictions are NOT linked to CoinGecko rounds** because:
- Users can update predictions at any time (not just when snapshots run)
- Prediction timestamps come from the blockchain (when user made the prediction)
- `roundId` is a CoinGecko oracle concept, not a blockchain concept
- Each prediction has its own individual timestamp stored on-chain

The `snapshotTimestamp` records when **we fetched** the data, while the individual prediction timestamps (e.g., `topPerformer1Timestamp`) record when the **user made** that specific prediction.

## Implementation

### 1. Database Table: `user_predictions_snapshots`

**Location:** `src/db/schema/user_predictions_snapshots.ts`

**Schema:**
```typescript
{
  id: uuid (primary key)
  walletAddress: varchar(44) - Solana wallet address
  
  // Top Performers (5 silos)
  topPerformer1-5: varchar(10) - Crypto ticker symbols
  topPerformer1-5Timestamp: bigint - Unix timestamps (when user made prediction)
  
  // Worst Performers (5 silos)
  worstPerformer1-5: varchar(10) - Crypto ticker symbols
  worstPerformer1-5Timestamp: bigint - Unix timestamps (when user made prediction)
  
  points: bigint - User's current points
  lastUpdated: bigint - Last update timestamp from blockchain
  
  snapshotTimestamp: timestamp - When we fetched this snapshot (our backend time)
  createdAt: timestamp - Record creation time
}
```

**Key Fields:**
- `walletAddress` - Identifies the user
- `snapshotTimestamp` - When we captured this snapshot (for tracking our fetch times)
- `topPerformer1Timestamp` etc. - When the user actually made each prediction (blockchain time)
- `lastUpdated` - When user last updated any prediction on-chain

### 2. Solana Integration Library

**Location:** `src/lib/solana-predictions.ts`

**Key Functions:**

#### `getAllInitializedUsers(connection: Connection)`
- Fetches all user accounts from the FutureFrog program
- Returns: `{ pubkey, points, lastUpdated }[]`
- Uses program account filtering (dataSize: 196 bytes)

#### `fetchUserPredictions(connection: Connection, userPubkey: PublicKey)`
- Fetches detailed predictions for a specific user
- Parses on-chain account data structure
- Returns: `UserPredictions` object with all 5 silos and timestamps

#### `fetchAllUserPredictions(connection: Connection)`
- Main function used by Inngest job
- Fetches all users and their complete predictions
- Returns: `{ userAddress, predictions }[]`

### 3. Updated Inngest Job

**Location:** `src/inngest/crypto-snapshot.ts`

**New Step 5:** "fetch-user-predictions"

**Process Flow:**
1. Connect to Solana RPC (uses `SOLANA_RPC_URL` env variable)
2. Call `fetchAllUserPredictions()` to get all user data from blockchain
3. Map blockchain data to database records
4. Insert into `user_predictions_snapshots` table
5. Log the count of inserted records

**Important:** This step runs independently of the CoinGecko data. It simply captures the current state of user predictions at the time the job runs.

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Inngest Crypto Snapshot                   │
│                     (Runs every 15 mins)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ├─ Step 1: Fetch CoinGecko Data
                              ├─ Step 2: Filter & Rank
                              ├─ Step 3: Populate Cache
                              ├─ Step 4: Insert Performance Logs (with roundId)
                              │
                              ├─ Step 5: Fetch User Predictions ⭐ NEW
                              │           │ (Independent - no roundId)
                              │           ├─ Connect to Solana RPC
                              │           ├─ Get all initialized users
                              │           ├─ Fetch predictions for each
                              │           └─ Insert into DB
                              │
                              └─ Complete & Log Summary
```

## Database Queries

### Get Latest Snapshot of All Users
```sql
SELECT * FROM user_predictions_snapshots
WHERE snapshot_timestamp = (
  SELECT MAX(snapshot_timestamp) 
  FROM user_predictions_snapshots
);
```

### Get User Prediction History
```sql
SELECT * FROM user_predictions_snapshots
WHERE wallet_address = 'USER_WALLET_ADDRESS'
ORDER BY snapshot_timestamp DESC;
```

### Track How User's Prediction Changed Over Time
```sql
SELECT 
  wallet_address,
  snapshot_timestamp,
  top_performer_1,
  top_performer_1_timestamp,
  points
FROM user_predictions_snapshots
WHERE wallet_address = 'USER_ADDRESS'
ORDER BY snapshot_timestamp DESC;
```

### Find Users Who Made New Predictions Recently
```sql
-- Users whose prediction timestamps are newer than their last snapshot
SELECT 
  wallet_address,
  snapshot_timestamp,
  top_performer_1,
  top_performer_1_timestamp
FROM user_predictions_snapshots
WHERE top_performer_1_timestamp > EXTRACT(EPOCH FROM snapshot_timestamp - INTERVAL '1 hour')
ORDER BY top_performer_1_timestamp DESC;
```

### Count Active Users Per Snapshot
```sql
SELECT 
  snapshot_timestamp,
  COUNT(*) as total_users,
  COUNT(CASE WHEN top_performer_1 IS NOT NULL THEN 1 END) as users_with_predictions,
  SUM(points) as total_points
FROM user_predictions_snapshots
GROUP BY snapshot_timestamp
ORDER BY snapshot_timestamp DESC;
```

## Use Cases

### 1. Historical Tracking
Track how user predictions evolve over time, independent of market snapshots.

### 2. Accuracy Analysis (Future)
Compare user predictions at timestamp T with actual crypto performance. Since predictions have their own timestamps, you can:
- Get prediction made at 10:00 AM
- Compare with crypto performance 24 hours later
- Calculate accuracy based on when prediction was actually made

### 3. User Engagement Metrics
- When do users update predictions?
- How often do they change picks?
- Correlation between prediction activity and market volatility

### 4. Points Audit
Historical record of points at each snapshot, useful for:
- Verifying point calculations
- Tracking point growth over time
- Identifying when points were awarded

### 5. Popular Crypto Analysis
Which cryptos are most commonly predicted by users over time?

## Comparing With CoinGecko Data

While user predictions aren't linked by `roundId`, you can still correlate them with crypto performance:

```sql
-- Example: Compare user predictions with crypto performance
-- Find users who predicted BTC as top performer, then see how BTC actually performed

-- 1. Get users who predicted BTC at a certain time
SELECT 
  wallet_address,
  top_performer_1,
  top_performer_1_timestamp,
  snapshot_timestamp
FROM user_predictions_snapshots
WHERE top_performer_1 = 'BTC'
  AND top_performer_1_timestamp BETWEEN 
    EXTRACT(EPOCH FROM '2025-12-19 00:00:00'::timestamp) AND
    EXTRACT(EPOCH FROM '2025-12-19 23:59:59'::timestamp);

-- 2. Get BTC performance from crypto_performance_logs for the same day
SELECT 
  symbol,
  price_change_percentage_24h,
  performance_category,
  snapshot_timestamp
FROM crypto_performance_logs
WHERE symbol = 'BTC'
  AND DATE(snapshot_timestamp) = '2025-12-19';
```

## Environment Variables

**Required:**
- `SOLANA_RPC_URL` - Solana RPC endpoint (defaults to mainnet-beta)

**Recommended:**
- Use a premium RPC provider for reliability (e.g., Helius, QuickNode)
- Example: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`

## Logging Output

When the job runs:
```
========================================
🐸 [Crypto Snapshot] Starting Round {uuid}
========================================

   ... (CoinGecko steps) ...
   
   🔗 Connecting to Solana RPC: https://api.mainnet-beta.solana.com
   📡 Fetching all initialized users from blockchain...
   👥 Found 25 initialized users
   ✅ Successfully fetched predictions for 25 users
   💾 Inserted 25 user prediction records

========================================
✅ [Crypto Snapshot] Round {uuid} COMPLETED
   Duration: 3452ms (3.45s)
   Performance logs: 10 records
   Cache records: 100 records
   User predictions: 25 records
   Top gainer: Bitcoin
   Worst performer: Dogecoin
========================================
```

## Testing

### Test Script:
```bash
cd /Users/moreshkokane/code/futurefrog-backend
bun run scripts/test-user-predictions-fetch.ts
```

### Verify Database After Job Runs:
```sql
-- Check latest snapshot
SELECT 
  COUNT(*) as user_count,
  SUM(points) as total_points,
  MAX(snapshot_timestamp) as latest_snapshot
FROM user_predictions_snapshots;

-- Verify individual prediction timestamps
SELECT 
  wallet_address,
  top_performer_1,
  top_performer_1_timestamp,
  TO_TIMESTAMP(top_performer_1_timestamp) as prediction_made_at,
  snapshot_timestamp as we_fetched_at
FROM user_predictions_snapshots
WHERE snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM user_predictions_snapshots)
LIMIT 5;
```

## Future Enhancements

### 1. Accuracy Scoring Algorithm
Compare user predictions with actual performance:
```sql
-- Pseudocode approach:
-- 1. For each user prediction timestamp T
-- 2. Get crypto performance 24h after T
-- 3. Calculate if prediction was correct
-- 4. Award points based on accuracy
```

### 2. Prediction Change Detection
Track when users change their predictions:
```sql
-- Compare consecutive snapshots to see what changed
WITH ranked_snapshots AS (
  SELECT *,
    LAG(top_performer_1) OVER (PARTITION BY wallet_address ORDER BY snapshot_timestamp) as prev_top_1
  FROM user_predictions_snapshots
  WHERE wallet_address = 'USER_ADDRESS'
)
SELECT * FROM ranked_snapshots
WHERE top_performer_1 != prev_top_1 OR prev_top_1 IS NULL;
```

### 3. Prediction Timing Analysis
Analyze when users make predictions vs market events:
- Do users predict before or after big moves?
- Correlation between prediction timing and success rate

## Performance Considerations

- **RPC Rate Limits:** Free RPC endpoints may throttle with many users
- **Batch Processing:** Currently fetches all users in parallel
- **Storage Growth:** ~1 row per user per snapshot (grows over time)
- **Indexing:** Add indexes on `wallet_address` and `snapshot_timestamp` for faster queries

## Summary

This feature provides:
- ✅ Independent tracking of user predictions (not tied to CoinGecko rounds)
- ✅ Individual timestamps for each prediction (from blockchain)
- ✅ Historical snapshots of user state over time
- ✅ Foundation for accuracy-based point calculations
- ✅ Data for user engagement and behavior analysis

The key insight is that **user predictions operate on their own timeline**, separate from the CoinGecko oracle snapshots. We simply capture the current state periodically for historical tracking.


