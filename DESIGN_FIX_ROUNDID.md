# Design Fix: Removed roundId from User Predictions

## Problem Identified

The initial implementation incorrectly linked user predictions to CoinGecko `roundId`. This was a design flaw because:

1. **roundId is a CoinGecko concept** - It tracks oracle snapshots, not user predictions
2. **User predictions are independent** - Users can update predictions at any time, not tied to snapshot rounds
3. **Timestamps come from blockchain** - Each prediction has its own timestamp from when the user made it
4. **No contract-level roundId** - The smart contract doesn't know about our backend's roundId system

## What Was Fixed

### 1. Removed `roundId` from Schema
**File:** `src/db/schema/user_predictions_snapshots.ts`

**Before:**
```typescript
roundId: uuid("round_id").notNull(),
```

**After:**
```typescript
// Removed - roundId doesn't apply to user predictions
```

### 2. Updated Inngest Job
**File:** `src/inngest/crypto-snapshot.ts`

**Before:**
```typescript
const userRecords = allUserPredictions.map(({ userAddress, predictions }) => ({
    roundId: filterAndRank.roundId,  // ❌ Wrong - linking unrelated data
    walletAddress: userAddress,
    ...
}));
```

**After:**
```typescript
const userRecords = allUserPredictions.map(({ userAddress, predictions }) => ({
    walletAddress: userAddress,  // ✅ Correct - no roundId
    ...
}));
```

### 3. Database Migration
**File:** `drizzle/0004_smart_whiplash.sql`

```sql
ALTER TABLE "user_predictions_snapshots" DROP COLUMN "round_id";
```

## Correct Design

### Timeline Independence

```
CoinGecko Timeline (with roundId):
├── Round 1 (10:00 AM) - BTC +5%, ETH -2%
├── Round 2 (10:15 AM) - BTC +3%, ETH +1%
└── Round 3 (10:30 AM) - BTC -1%, ETH +4%

User Predictions Timeline (independent):
├── User A predicts BTC @ 9:45 AM  (before any rounds)
├── User B predicts ETH @ 10:07 AM (during round 1)
└── User A updates to ETH @ 10:22 AM (between rounds)

Our Snapshots:
├── Snapshot 1 (10:15 AM) - Captures state: A→BTC(9:45), B→ETH(10:07)
└── Snapshot 2 (10:30 AM) - Captures state: A→ETH(10:22), B→ETH(10:07)
```

### Key Fields in Database

```typescript
{
  walletAddress: string          // Who made the prediction
  topPerformer1: string          // What they predicted
  topPerformer1Timestamp: bigint // When they made it (from blockchain)
  snapshotTimestamp: timestamp   // When we fetched it (our backend)
}
```

**Important distinction:**
- `topPerformer1Timestamp` = When user made the prediction (blockchain time)
- `snapshotTimestamp` = When we captured this snapshot (our fetch time)

## How to Correlate Data

Even without `roundId`, you can still analyze predictions against performance:

### Example 1: Time-based Correlation
```sql
-- Find predictions made around the same time as a crypto spike
SELECT 
  ups.wallet_address,
  ups.top_performer_1,
  TO_TIMESTAMP(ups.top_performer_1_timestamp) as predicted_at,
  cpl.price_change_percentage_24h,
  cpl.snapshot_timestamp as crypto_data_at
FROM user_predictions_snapshots ups
JOIN crypto_performance_logs cpl 
  ON LOWER(ups.top_performer_1) = LOWER(cpl.symbol)
  AND ABS(EXTRACT(EPOCH FROM cpl.snapshot_timestamp) - ups.top_performer_1_timestamp) < 3600
WHERE cpl.performance_category = 'top_gainer';
```

### Example 2: Accuracy at Snapshot Time
```sql
-- For each snapshot, check which users predicted correctly
WITH latest_crypto AS (
  SELECT DISTINCT ON (symbol)
    symbol,
    performance_category,
    performance_rank,
    snapshot_timestamp
  FROM crypto_performance_logs
  ORDER BY symbol, snapshot_timestamp DESC
),
latest_users AS (
  SELECT DISTINCT ON (wallet_address)
    *
  FROM user_predictions_snapshots
  ORDER BY wallet_address, snapshot_timestamp DESC
)
SELECT 
  lu.wallet_address,
  lu.top_performer_1,
  lc.performance_category,
  lc.performance_rank
FROM latest_users lu
LEFT JOIN latest_crypto lc 
  ON LOWER(lu.top_performer_1) = LOWER(lc.symbol)
WHERE lc.performance_category = 'top_gainer';
```

## Benefits of This Design

### ✅ Correct Semantics
- User predictions are independent events
- Not artificially tied to oracle rounds
- Accurate timestamps from blockchain

### ✅ Flexibility
- Track predictions at any frequency
- Can compare with any time range of crypto data
- Not constrained by snapshot schedule

### ✅ Historical Accuracy
- Each prediction timestamp is preserved
- Can analyze "what did user know when they predicted?"
- Support retroactive accuracy calculations

### ✅ Scalability
- Users and crypto data can be snapshotted at different frequencies
- Can backfill user data independently
- Can adjust snapshot schedules without breaking relationships

## Testing

### Verify the Fix:
```bash
# Check that build works
bun run build

# Test blockchain fetch
bun run scripts/test-user-predictions-fetch.ts

# Apply migration (if you haven't already)
bun run db:push
```

### Verify Database:
```sql
-- Check schema doesn't have round_id
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'user_predictions_snapshots';

-- Should NOT include round_id column
```

## Summary

The fix removes the incorrect `roundId` linkage between user predictions and CoinGecko oracle rounds. Instead:

- **User predictions** are tracked independently with their own blockchain timestamps
- **Snapshot timestamp** records when we fetched the data
- **Correlation** happens at query time based on timestamps, not forced joins
- **Design** is now semantically correct and more flexible

This better reflects the reality that user predictions and crypto oracle data are independent data streams that can be compared but aren't inherently linked.


