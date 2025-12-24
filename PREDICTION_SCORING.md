# Prediction Scoring System

## Overview

The inngest crypto snapshot process now includes automatic scoring and reward distribution for user predictions. After fetching crypto performance data and user predictions, the system evaluates eligible predictions and awards points to users on the Solana blockchain.

## Eligibility Criteria

Predictions are eligible for scoring when:
- **Not yet processed** (`processed = false`)
- **Older than threshold**: `snapshotTimestamp` is older than `PREDICTION_INTERVAL_MINUTES` (env variable, default: 60 minutes)

## Point Scoring System

### Base Points (Per Prediction)

| Match Type | Points | Description |
|------------|--------|-------------|
| **Exact Match** | 50 | Correct symbol AND correct rank |
| **Category Match** | 10 | Correct symbol in correct category (top/worst), but wrong rank |
| **Participation** | 1 | Prediction made but symbol not in results |

### Parlay Bonuses (Per User)

Bonuses are awarded for getting multiple predictions correct in the same category:

#### Same Category Bonuses

| Correct Predictions | Bonus Points | Cumulative |
|---------------------|--------------|------------|
| 2 correct symbols | +25 | 25 |
| 3 correct symbols | +50 | 75 |
| 4 correct symbols | +125 | 200 |
| 5 correct symbols | +300 | 500 |

**Note:** These bonuses apply separately to `top_performer` and `worst_performer` categories.

#### Cross-Category Bonus

- **+50 points** if user has at least one correct prediction in BOTH categories

## Example Scenarios

### Scenario 1: Beginner Success
- **Predictions**: 2 correct symbols in top_performer (wrong ranks)
- **Calculation**: 
  - Base: 2 × 10 = 20
  - Parlay: +25
- **Total**: **45 points**

### Scenario 2: Mixed Performance
- **Predictions**: 
  - 1 exact match in top_performer
  - 2 category matches in worst_performer
  - 3 participation points
- **Calculation**:
  - Base: 50 + (2 × 10) + (3 × 1) = 73
  - Parlay (worst): +25
  - Cross-category: +50
- **Total**: **148 points**

### Scenario 3: Expert Play
- **Predictions**:
  - 3 exact matches in top_performer
  - 2 exact matches in worst_performer
- **Calculation**:
  - Base: (3 × 50) + (2 × 50) = 250
  - Parlay (top): 25 + 50 = 75
  - Parlay (worst): +25
  - Cross-category: +50
- **Total**: **400 points**

### Scenario 4: Perfect Prediction
- **Predictions**: All 5 exact matches in both categories
- **Calculation**:
  - Base: 10 × 50 = 500
  - Parlay (top): 25 + 50 + 125 + 300 = 500
  - Parlay (worst): 25 + 50 + 125 + 300 = 500
  - Cross-category: +50
- **Total**: **1,550 points**

## Process Flow

### Step 6: Score and Reward Predictions

1. **Find Eligible Predictions**
   - Query `user_predictions_snapshots` table
   - Filter: `processed = false` AND `snapshotTimestamp < (now - PREDICTION_INTERVAL_MINUTES)`

2. **Fetch Latest Round Results**
   - Get top 5 gainers and worst 5 performers from `crypto_performance_logs`
   - Build symbol-to-rank lookup maps for fast matching

3. **Score Each Prediction**
   - Compare prediction symbol against actual results
   - Award base points (50 for exact, 10 for category, 1 for participation)
   - Update `pointsEarned` column in database

4. **Calculate Parlay Bonuses**
   - Group predictions by user
   - Calculate bonuses based on total correct per category
   - Add cross-category bonus if applicable

5. **Update Blockchain**
   - Connect to Solana using admin keypair
   - For each user, read current points
   - Create transaction to update user points
   - Send and confirm transaction

6. **Record Transactions**
   - Create transaction records for each prediction reward
   - Create separate records for each parlay bonus type
   - Include Solana transaction signature in all records
   - Link transactions to related prediction IDs

7. **Mark as Processed**
   - Update all processed predictions: `processed = true`
   - Predictions retain individual `pointsEarned` value for audit trail

## Database Schema Updates

### New Columns in `user_predictions_snapshots`

```sql
processed BOOLEAN NOT NULL DEFAULT false
points_earned INTEGER DEFAULT 0
```

- **`processed`**: Prevents double-processing of predictions
- **`pointsEarned`**: Records how many points this specific prediction earned (for audit/analytics)

### New Table: `user_point_transactions`

Complete audit trail of all point awards:

```sql
CREATE TABLE user_point_transactions (
  id UUID PRIMARY KEY,
  wallet_address VARCHAR(44) NOT NULL,
  round_id UUID NOT NULL,
  transaction_type VARCHAR(30) NOT NULL,
  points_amount INTEGER NOT NULL,
  solana_signature VARCHAR(88),
  related_prediction_ids TEXT, -- JSON array of prediction IDs
  metadata TEXT, -- JSON field for extra context
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Transaction Types:**
- `prediction_exact_match` - 50 points per exact match
- `prediction_category_match` - 10 points per category match
- `prediction_participation` - 1 point per participation
- `parlay_bonus_top` - Bonus for multiple correct top performers
- `parlay_bonus_worst` - Bonus for multiple correct worst performers
- `cross_category_bonus` - 50 points for having correct predictions in both categories

**Benefits:**
- Full reconciliation: `SUM(points_amount)` = blockchain points awarded
- Audit trail with Solana transaction signatures
- Can trace which predictions contributed to each transaction
- Supports analytics and leaderboards

## Configuration

### Environment Variables

- `PREDICTION_INTERVAL_MINUTES` (default: 60)
  - Minimum age for predictions to be eligible for scoring
  - Prevents scoring predictions made too recently

- `PROGRAM_ID` (required)
  - Solana program ID for updating user points

- `SOLANA_RPC_URL` (default: mainnet)
  - RPC endpoint for blockchain transactions

## Logging

The scoring step provides detailed logging:

```
💰 Step 6: Scoring Eligible Predictions
⏰ Prediction interval: 60 minutes
📅 Cutoff time: 2024-12-19T20:00:00.000Z
✅ Found 42 eligible predictions to process
📈 Top performers: btc(#1), eth(#2), sol(#3), ...
📉 Worst performers: doge(#1), shib(#2), ...

🎯 EXACT MATCH: 9WzDXwBb... predicted btc at rank 1 in top_performer (+50)
✓ Category match: 7Xk2Pmn... predicted eth (rank 3, actual 2) in top_performer (+10)
• Participation: 5Rt9Kla... predicted ada in top_performer (+1)

💎 Calculating parlay bonuses...
🎰 9WzDXwBb... parlay bonus: +125 (top: 4/5, worst: 2/5)

🔗 Updating user points on Solana...
✅ 9WzDXwBb... +215 points (1000 → 1215) | tx: 3k5j8h2...

📊 Scoring Summary:
   Total eligible: 42
   Users processed: 8
   Total points awarded: 892
   Predictions marked processed: 42
```

## Reconciliation

To verify database points match blockchain:

```sql
-- Get total points awarded to a user in a specific round
SELECT 
  wallet_address,
  SUM(points_amount) as total_points,
  solana_signature
FROM user_point_transactions
WHERE wallet_address = 'USER_ADDRESS'
  AND round_id = 'ROUND_ID'
GROUP BY wallet_address, solana_signature;

-- Get breakdown by transaction type
SELECT 
  transaction_type,
  COUNT(*) as count,
  SUM(points_amount) as total_points
FROM user_point_transactions
WHERE wallet_address = 'USER_ADDRESS'
GROUP BY transaction_type;
```

## Error Handling

- If admin keypair cannot be loaded, scoring is skipped (logged as error)
- If user account doesn't exist on-chain, user is skipped (logged as warning)
- Individual transaction failures don't halt the entire process
- Failed predictions remain `processed = false` for retry on next run
- Transaction records are only created after blockchain confirmation succeeds

## Performance Considerations

- Scoring only runs for predictions older than interval threshold
- Database queries use indexes on `processed` and `snapshotTimestamp`
- Blockchain updates are batched per user (not per prediction)
- Transaction confirmations use 'confirmed' commitment level for speed

## Future Enhancements

Potential improvements:
- Time decay: Older predictions worth fewer points
- Difficulty multiplier: Predicting underdog coins worth more
- Streak bonuses: Consecutive correct rounds earn multipliers
- Leaderboard integration: Track top performers

