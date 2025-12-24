# Inngest Step 7: Clear Processed Predictions

## Overview

Added a new **Step 7** to the Inngest `crypto-snapshot` job that automatically clears user predictions after they have been scored and rewarded. This ensures users can make fresh predictions for the next round while preserving their accumulated points.

## What Was Added

### Step 7: `clear-processed-predictions`

**Location:** `src/inngest/crypto-snapshot.ts` (after Step 6)

**Purpose:** Clear all predictions for users who were just scored and rewarded, while preserving their points.

## How It Works

### 1. Track Processed Users (Step 6 Enhancement)

In Step 6 (`score-and-reward-predictions`), we now track which users were successfully processed:

```typescript
const processedUserAddresses: string[] = [];

// After successfully processing each user:
processedUserAddresses.push(update.walletAddress);

// Return in step result:
return {
    // ... other fields
    processedUserAddresses,
};
```

### 2. Clear Predictions in Batches (Step 7)

Step 7 receives the list of processed users and clears their predictions:

1. **Get Processed Users** - Extract the list from Step 6 results
2. **Batch Processing** - Group users into batches of up to 10
3. **Create Instructions** - Build `admin_clear_user_silos` instruction for each user
4. **Send Transactions** - Send one transaction per batch (10 users max)
5. **Confirm & Log** - Wait for confirmation and log results

### Batching Strategy

```
Users Processed: [User1, User2, ..., User25]
                      ↓
        Split into batches of 10
                      ↓
Batch 1: [User1...User10]  → Transaction 1 → 10 clear instructions
Batch 2: [User11...User20] → Transaction 2 → 10 clear instructions
Batch 3: [User21...User25] → Transaction 3 → 5 clear instructions
```

**Benefits:**
- Reduces transaction fees by ~90% (vs 1 transaction per user)
- Faster processing (fewer network calls)
- More efficient use of Solana block space

## What Gets Cleared

For each user, the `admin_clear_user_silos` instruction clears:

✅ All 5 Top Performer predictions (set to empty)
✅ All 5 Worst Performer predictions (set to empty)
✅ All 10 prediction timestamps (set to 0)
✅ Updates `last_updated` (set to current time)

**What's preserved:**
✅ User's points (completely unchanged)

## Code Flow

```
Step 6: Score & Reward
    ↓
Track successfully processed users
    ↓
Return: { processedUserAddresses: [...] }
    ↓
Step 7: Clear Predictions
    ↓
Get processedUserAddresses from Step 6
    ↓
If empty → Skip (no users to clear)
    ↓
If not empty → Process in batches
    ↓
For each batch of ≤10 users:
    1. Create clear instructions
    2. Build transaction
    3. Sign with admin keypair
    4. Send & confirm
    5. Log results
    ↓
Return: { totalUsers, usersCleared, batchesProcessed }
```

## Logging Output

### When Step 7 Runs Successfully

```
   ========================================
   🧹 Step 7: Clearing Processed Predictions
   ========================================

   📋 Found 25 users to clear
   🔑 Admin keypair loaded: J8yaYV...qXFeo
   📦 Processing 25 users in 3 batches (max 10 per batch)
   ✅ Batch 1/3: Cleared 10 users | tx: 2xcnVQz8...
      • 6EMtKnxy... predictions cleared
      • 9WzDXwBb... predictions cleared
      ... (8 more users)
   ✅ Batch 2/3: Cleared 10 users | tx: 5dkeP9mN...
      ... (10 users)
   ✅ Batch 3/3: Cleared 5 users | tx: 8jqAx2Rt...
      ... (5 users)

   ========================================
   📊 Clear Predictions Summary:
      Total users: 25
      Successfully cleared: 25
      Batches processed: 3
   ========================================
```

### When No Users Need Clearing

```
   ========================================
   🧹 Step 7: Clearing Processed Predictions
   ========================================

   ℹ️  No users to clear (no predictions were processed)
```

## Final Summary (Updated)

The final Inngest job summary now includes clearing statistics:

```
========================================
✅ [Crypto Snapshot] Round abc-123-def COMPLETED
   Duration: 15234ms (15.23s)
   Performance logs: 10 records
   Cache records: 100 records
   User predictions: 25 new/updated, 0 duplicates, 0 errors, 25 total
   Scoring: 25 users, 1250 points awarded
   Clearing: 25/25 users cleared in 3 batches  ← NEW
   Top gainer: Bitcoin
   Worst performer: Dogecoin
========================================
```

## Return Value (Updated)

The Inngest job now returns clearing information:

```typescript
{
  success: true,
  roundId: "abc-123-def",
  // ... other fields
  scoring: {
    totalEligible: 250,
    usersProcessed: 25,
    totalPointsAwarded: 1250,
    predictionsProcessed: 250,
  },
  clearing: {              // NEW
    totalUsers: 25,        // Users who were processed
    usersCleared: 25,      // Successfully cleared
    batchesProcessed: 3,   // Number of batches
  }
}
```

## Error Handling

### Batch Failure

If a batch fails, the error is logged but processing continues:

```typescript
❌ Error processing batch 2: Transaction simulation failed
   Failed: 9WzDXwBb...
   Failed: ALtVPTz6...
   ... (other users in failed batch)
```

Other batches continue to process independently.

### Admin Keypair Failure

If the admin keypair can't be loaded:

```typescript
❌ Error loading admin keypair: SALT not found
```

The step returns early with zero counts.

## Configuration

### Environment Variables

Uses existing environment variables:

- `PROGRAM_ID` - Solana program ID (required)
- `SOLANA_RPC_URL` - RPC endpoint (defaults to mainnet)
- `SALT` - For decrypting admin keypair (required)

### Constants

- `BATCH_SIZE = 10` - Maximum users per transaction
- `ADMIN_CLEAR_USER_SILOS_IX = 0x72ee6dd7f7ac3ce9` - Instruction discriminator

## Technical Details

### Instruction: `admin_clear_user_silos`

**Smart Contract:** `programs/futurefrog/src/lib.rs` (lines 178-194)

**Discriminator:** `0x72, 0xee, 0x6d, 0xd7, 0xf7, 0xac, 0x3c, 0xe9`

**Accounts Required:**
1. User Predictions PDA (writable)
2. Global State PDA (readonly)
3. Admin Signer (signer)

**What It Does:**
```rust
pub fn admin_clear_user_silos(ctx: Context<AdminClearUserSilos>) -> Result<()> {
    let user_predictions = &mut ctx.accounts.user_predictions;
    
    // Clear all silos and timestamps
    for i in 0..5 {
        user_predictions.top_performer[i] = [b' '; 6];
        user_predictions.worst_performer[i] = [b' '; 6];
        user_predictions.top_performer_timestamps[i] = 0;
        user_predictions.worst_performer_timestamps[i] = 0;
    }
    
    user_predictions.last_updated = current_timestamp();
    
    // Points are NOT modified
    msg!("Admin cleared all silos for user: {} (points preserved: {})", 
        user_predictions.owner, user_predictions.points);
    Ok(())
}
```

### Transaction Structure

Each batch transaction contains:
- 1 transaction with up to 10 instructions
- Each instruction clears one user's predictions
- Signed by admin keypair
- Sent with `skipPreflight: false` for safety

### Gas Optimization

**Before (Individual Transactions):**
- 25 users = 25 transactions
- Cost: ~25 × 0.000005 SOL = 0.000125 SOL

**After (Batched Transactions):**
- 25 users = 3 transactions (10+10+5)
- Cost: ~3 × 0.000005 SOL = 0.000015 SOL
- **Savings: ~88%** 🎉

## Complete Job Flow (All 7 Steps)

```
┌─────────────────────────────────────────────┐
│  Crypto Snapshot Inngest Job (Cron/Manual)  │
└─────────────────────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 1: Fetch CoinGecko     │
      └─────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 2: Filter & Rank       │
      └─────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 3: Populate Cache      │
      └─────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 4: Performance Logs    │
      └─────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 5: User Predictions    │
      └─────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 6: Score & Reward      │ → Track processed users
      └─────────────────────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Step 7: Clear Predictions   │ → Clear in batches ⭐ NEW
      └─────────────────────────────┘
```

## Benefits of Auto-Clearing

1. **Fresh Slate** - Users get empty prediction slots for next round
2. **No Manual Work** - Automatic cleanup after scoring
3. **Points Preserved** - User progress is maintained
4. **Gas Efficient** - Batched clearing saves transaction fees
5. **Consistent State** - Predictions cleared right after being scored
6. **Ready for Next Round** - Users can immediately make new predictions

## Use Cases

### Daily Rounds

If running predictions daily:
1. Round N completes
2. Users are scored (Step 6)
3. Predictions cleared (Step 7)
4. Users make new predictions for Round N+1
5. Repeat

### Hourly Rounds

Same flow, but faster cycle:
- Every hour, process predictions
- Score and reward
- Clear for next hour
- Points accumulate across all rounds

## Comparison: Manual vs Automatic

### Before (Manual Clearing)

```bash
# Admin had to run manually:
bun run scripts/clear-user-predictions.ts User1
bun run scripts/clear-user-predictions.ts User2
# ... repeat for all users
```

**Problems:**
- Manual effort required
- Easy to forget
- Timing inconsistency
- Individual transactions (expensive)

### After (Automatic Clearing)

```
✅ Runs automatically after scoring
✅ No manual intervention needed
✅ Consistent timing
✅ Batched transactions (90% cheaper)
```

## Monitoring

### Success Indicators

- `usersCleared === totalUsers` → All users cleared
- `batchesProcessed > 0` → Batches executed
- No error messages in logs

### Warning Signs

- `usersCleared < totalUsers` → Some users failed
- Error messages about admin keypair → Check SALT
- Transaction failures → Check RPC URL or SOL balance

## Testing

### Manual Test

Trigger the job manually:

```bash
# In your Inngest dashboard or via API
POST /api/inngest
{
  "event": "crypto/snapshot.manual"
}
```

Check logs for Step 7 output.

### Verify Clearing

After job runs, check a user's predictions:

```bash
bun run scripts/verify-user-predictions.ts <user_address>
```

Should show empty predictions but preserved points.

## Future Enhancements

Potential improvements:

1. **Configurable Batch Size** - Allow env variable for batch size
2. **Selective Clearing** - Clear only certain prediction types
3. **Retry Logic** - Retry failed batches
4. **Metrics Dashboard** - Track clearing success rates
5. **Dry Run Mode** - Test without actually clearing

## Related Documentation

- `CLEAR_USER_PREDICTIONS.md` - Manual clearing script
- `PREDICTION_SCORING.md` - How Step 6 scoring works
- `USER_PREDICTIONS_FEATURE.md` - Prediction structure
- `CRYPTO_SNAPSHOT_IMPLEMENTATION.md` - Overall job documentation

## Summary

Step 7 provides automatic, efficient, and reliable clearing of user predictions after scoring. It maintains the cycle of predict → score → clear → predict again, while preserving user points and minimizing transaction costs through batching.

**Key Stats:**
- ⚡ 90% reduction in gas costs vs individual clearing
- 🎯 Automatic execution after scoring
- 💎 Points always preserved
- 📦 Up to 10 users per transaction
- ✅ Production-ready with error handling

