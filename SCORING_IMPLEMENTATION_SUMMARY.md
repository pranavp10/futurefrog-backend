# Prediction Scoring Implementation - Summary

## What Was Built

A complete prediction scoring and point tracking system that:
1. ✅ Scores user predictions against actual crypto performance
2. ✅ Awards base points + parlay bonuses
3. ✅ Updates points on Solana blockchain
4. ✅ Records ALL transactions for full audit trail
5. ✅ Ensures database reconciles with blockchain

## Files Created/Modified

### New Schema Files
- ✅ `src/db/schema/user_point_transactions.ts` - Transaction tracking table
- ✅ Updated `src/db/schema/user_predictions_snapshots.ts` - Added `processed` and `pointsEarned` columns
- ✅ Updated `src/db/schema/index.ts` - Export new table

### Migrations
- ✅ `drizzle/0006_add_processed_column.sql`
- ✅ `drizzle/0007_add_points_awarded_column.sql`
- ✅ `drizzle/0008_create_user_point_transactions.sql`
- ✅ Updated `drizzle/meta/_journal.json`

### Core Logic
- ✅ Updated `src/inngest/crypto-snapshot.ts` - Added Step 6: Scoring & Rewards

### Documentation
- ✅ `PREDICTION_SCORING.md` - Complete scoring system explanation
- ✅ `TRANSACTION_TRACKING_EXAMPLE.md` - Example with calculations
- ✅ `SCORING_IMPLEMENTATION_SUMMARY.md` - This file

## Migration Instructions

### Step 1: Run Migrations

```bash
cd /Users/moreshkokane/code/futurefrog-backend

# Option A: Push directly to database
npx drizzle-kit push

# Option B: Generate and run migrations
npx drizzle-kit migrate
```

This will:
- Add `processed` column to `user_predictions_snapshots`
- Add `points_earned` column to `user_predictions_snapshots`
- Create `user_point_transactions` table with indexes

### Step 2: Add Environment Variable

Add to your `.env` file:

```bash
# How old predictions must be before they're eligible for scoring (in minutes)
PREDICTION_INTERVAL_MINUTES=60
```

### Step 3: Verify Schema

```bash
# Check that tables exist
psql $DATABASE_URL -c "\d user_predictions_snapshots"
psql $DATABASE_URL -c "\d user_point_transactions"
```

Expected output should show the new columns and table.

### Step 4: Test the Inngest Function

The scoring step will automatically run on the next scheduled inngest execution, or you can trigger manually:

```bash
# Trigger a manual snapshot (if configured)
# This depends on your inngest setup
```

## Point Scoring System

### Base Points (Per Prediction)
| Match Type | Points | Description |
|------------|--------|-------------|
| Exact Match | 50 | Correct symbol + correct rank |
| Category Match | 10 | Correct symbol, wrong rank |
| Participation | 1 | Prediction made |

### Parlay Bonuses (Per User)
| Correct | Bonus | Cumulative |
|---------|-------|------------|
| 2 correct | +25 | 25 |
| 3 correct | +50 | 75 |
| 4 correct | +125 | 200 |
| 5 correct | +300 | 500 |

**Note:** Bonuses apply separately to top_performer and worst_performer categories

### Cross-Category Bonus
- +50 points if correct predictions in BOTH categories

## Transaction Tracking

Every point award is recorded in `user_point_transactions` with:
- Transaction type (exact match, category match, parlay, etc.)
- Points amount
- Solana transaction signature
- Related prediction IDs
- Metadata (for context)

**Reconciliation Formula:**
```
SUM(user_point_transactions.points_amount) 
  WHERE wallet = X AND round = Y
= 
Points added to blockchain for user X in round Y
```

## Process Flow

1. **Inngest runs** (scheduled or manual)
2. **Steps 1-5 execute** (fetch crypto data, user predictions, populate tables)
3. **Step 6: Scoring**
   - Find unprocessed predictions older than `PREDICTION_INTERVAL_MINUTES`
   - Score each prediction (50, 10, or 1 points)
   - Calculate parlay bonuses per user
   - Update points on Solana blockchain
   - Record all transactions in `user_point_transactions`
   - Mark predictions as `processed = true`

## Verification Queries

### Check Total Points Awarded
```sql
SELECT 
  wallet_address,
  SUM(points_amount) as total_points,
  COUNT(*) as transaction_count
FROM user_point_transactions
WHERE round_id = 'YOUR_ROUND_ID'
GROUP BY wallet_address;
```

### Breakdown by Type
```sql
SELECT 
  transaction_type,
  COUNT(*) as count,
  SUM(points_amount) as total_points,
  AVG(points_amount) as avg_points
FROM user_point_transactions
GROUP BY transaction_type
ORDER BY total_points DESC;
```

### Verify Reconciliation
```sql
-- For a specific user and round
SELECT 
  'Total from transactions' as source,
  SUM(points_amount) as points
FROM user_point_transactions
WHERE wallet_address = 'USER_ADDRESS' 
  AND round_id = 'ROUND_ID'

UNION ALL

SELECT 
  'Individual prediction points' as source,
  SUM(points_earned) as points
FROM user_predictions_snapshots
WHERE wallet_address = 'USER_ADDRESS'
  AND processed = true;

-- The transaction total should be HIGHER because it includes parlay bonuses
```

## Key Features

### 🎯 Fair Scoring
- Everyone gets at least 1 point per prediction (participation)
- Rewards accuracy (50 for exact, 10 for category)
- Big bonuses for parlay-style correct predictions

### 📊 Complete Audit Trail
- Every point tracked with reason and blockchain signature
- Can prove to users how they earned points
- Easy to debug if discrepancies arise

### 🔄 Idempotent Processing
- `processed` flag prevents double-scoring
- Failed blockchain updates don't mark predictions as processed
- Can safely retry failed scoring attempts

### 🚀 Performance
- Only processes predictions older than threshold
- Batch updates by user (not per prediction)
- Indexed queries for fast lookups

## Troubleshooting

### Issue: Predictions not being scored
**Check:**
1. Are predictions older than `PREDICTION_INTERVAL_MINUTES`?
2. Is `processed = false`?
3. Check inngest logs for errors

### Issue: Points don't match blockchain
**Check:**
1. Look at `user_point_transactions` for that user/round
2. Verify Solana transaction signature exists and is valid
3. Check if any transactions failed (missing signature)

### Issue: No parlay bonuses recorded
**Check:**
1. Did user have 2+ correct predictions in same category?
2. Check that symbols were actually in the results for that round
3. Verify `parlay_bonus_*` transactions exist for that user

## Next Steps (Optional Enhancements)

1. **Leaderboard API**: Query top users by total points
2. **User Dashboard**: Show transaction history and breakdown
3. **Time Decay**: Older predictions worth fewer points
4. **Difficulty Multiplier**: Underdog coins worth more
5. **Streak Bonuses**: Consecutive correct rounds
6. **Weekly/Monthly Prizes**: Based on points earned

## Testing Checklist

- [ ] Run migrations successfully
- [ ] Trigger inngest snapshot
- [ ] Verify predictions are scored (check `processed` column)
- [ ] Check `user_point_transactions` has records
- [ ] Verify Solana transactions succeeded (check signatures on explorer)
- [ ] Run reconciliation query to ensure database matches blockchain
- [ ] Test with users who have different prediction patterns:
  - [ ] All exact matches
  - [ ] Mix of exact and category
  - [ ] Only participation
  - [ ] Parlay bonuses in one category
  - [ ] Cross-category bonus

## Support

For questions or issues:
1. Check the documentation files: `PREDICTION_SCORING.md`, `TRANSACTION_TRACKING_EXAMPLE.md`
2. Review inngest logs for detailed step-by-step execution
3. Query `user_point_transactions` to trace specific point awards
4. Verify Solana transactions on Solana Explorer using the `solana_signature` field
