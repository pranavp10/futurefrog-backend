# Transaction Tracking Example

## Overview

This document shows how point awards are tracked in the `user_point_transactions` table, ensuring full reconciliation between database and blockchain.

## Example Scenario

**User:** `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`  
**Round:** `abc123-def456-...`

### User's Predictions

**Top Performers:**
1. BTC (predicted rank 1, actual rank 1) → **EXACT MATCH** ✅
2. ETH (predicted rank 2, actual rank 3) → **CATEGORY MATCH** ✅
3. SOL (predicted rank 3, actual rank 2) → **CATEGORY MATCH** ✅
4. ADA (predicted rank 4, not in results) → **PARTICIPATION**
5. MATIC (predicted rank 5, not in results) → **PARTICIPATION**

**Worst Performers:**
1. DOGE (predicted rank 1, actual rank 1) → **EXACT MATCH** ✅
2. SHIB (predicted rank 2, actual rank 5) → **CATEGORY MATCH** ✅
3. XRP (predicted rank 3, not in results) → **PARTICIPATION**
4. Empty slot
5. Empty slot

## Point Calculation

### Base Points (Individual Predictions)
- BTC exact match: **50 points**
- ETH category match: **10 points**
- SOL category match: **10 points**
- ADA participation: **1 point**
- MATIC participation: **1 point**
- DOGE exact match: **50 points**
- SHIB category match: **10 points**
- XRP participation: **1 point**

**Subtotal: 133 points**

### Parlay Bonuses
- **Top performers**: 3 correct → 25 + 50 = **75 points**
- **Worst performers**: 2 correct → **25 points**
- **Cross-category**: Has correct in both → **50 points**

**Bonus total: 150 points**

### Grand Total
**133 + 150 = 283 points**

## Transaction Records Created

After blockchain update succeeds (signature: `5KJp7R...Xy9zT`), these records are inserted:

### 1. Individual Prediction Transactions (8 records)

```sql
-- BTC exact match
{
  id: "uuid-1",
  wallet_address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  round_id: "abc123-def456-...",
  transaction_type: "prediction_exact_match",
  points_amount: 50,
  solana_signature: "5KJp7R...Xy9zT",
  related_prediction_ids: '["pred-id-1"]',
  metadata: '{"symbol":"BTC","rank":1,"predictionType":"top_performer"}'
}

-- ETH category match
{
  id: "uuid-2",
  wallet_address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  round_id: "abc123-def456-...",
  transaction_type: "prediction_category_match",
  points_amount: 10,
  solana_signature: "5KJp7R...Xy9zT",
  related_prediction_ids: '["pred-id-2"]',
  metadata: '{"symbol":"ETH","rank":2,"predictionType":"top_performer"}'
}

-- ... (6 more similar records for other predictions)
```

### 2. Top Performer Parlay Bonus (1 record)

```sql
{
  id: "uuid-9",
  wallet_address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  round_id: "abc123-def456-...",
  transaction_type: "parlay_bonus_top",
  points_amount: 75,
  solana_signature: "5KJp7R...Xy9zT",
  related_prediction_ids: '["pred-id-1","pred-id-2","pred-id-3"]',
  metadata: '{"correctCount":3,"totalSlots":5}'
}
```

### 3. Worst Performer Parlay Bonus (1 record)

```sql
{
  id: "uuid-10",
  wallet_address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  round_id: "abc123-def456-...",
  transaction_type: "parlay_bonus_worst",
  points_amount: 25,
  solana_signature: "5KJp7R...Xy9zT",
  related_prediction_ids: '["pred-id-6","pred-id-7"]',
  metadata: '{"correctCount":2,"totalSlots":5}'
}
```

### 4. Cross-Category Bonus (1 record)

```sql
{
  id: "uuid-11",
  wallet_address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  round_id: "abc123-def456-...",
  transaction_type: "cross_category_bonus",
  points_amount: 50,
  solana_signature: "5KJp7R...Xy9zT",
  related_prediction_ids: '["pred-id-1","pred-id-2","pred-id-3","pred-id-6","pred-id-7"]',
  metadata: '{"topCorrect":3,"worstCorrect":2}'
}
```

## Total Records: 11

- 8 individual prediction rewards
- 1 top performer parlay bonus
- 1 worst performer parlay bonus
- 1 cross-category bonus

## Reconciliation Query

```sql
SELECT 
  transaction_type,
  COUNT(*) as count,
  SUM(points_amount) as points
FROM user_point_transactions
WHERE wallet_address = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  AND round_id = 'abc123-def456-...'
GROUP BY transaction_type;
```

**Result:**
```
transaction_type              | count | points
------------------------------|-------|-------
prediction_exact_match        |   2   |  100
prediction_category_match     |   3   |   30
prediction_participation      |   3   |    3
parlay_bonus_top             |   1   |   75
parlay_bonus_worst           |   1   |   25
cross_category_bonus         |   1   |   50
------------------------------|-------|-------
TOTAL                        |  11   |  283  ✅
```

**283 points** matches exactly what was sent to the blockchain! 🎯

## Benefits

1. **Complete Audit Trail**: Every point has a record explaining why it was awarded
2. **Blockchain Linkage**: Can verify any award on Solana using the signature
3. **Analytics Ready**: Easy to query top performers, most successful strategies, etc.
4. **Debugging**: If points don't match, can trace exactly which transaction caused discrepancy
5. **Fairness**: Users can see detailed breakdown of how they earned points

## Future Queries

### User Leaderboard
```sql
SELECT 
  wallet_address,
  SUM(points_amount) as total_points,
  COUNT(DISTINCT round_id) as rounds_participated
FROM user_point_transactions
GROUP BY wallet_address
ORDER BY total_points DESC
LIMIT 10;
```

### Best Performing Strategy
```sql
-- Which prediction type yields the most points on average?
SELECT 
  transaction_type,
  AVG(points_amount) as avg_points,
  COUNT(*) as count
FROM user_point_transactions
WHERE transaction_type LIKE 'prediction_%'
GROUP BY transaction_type
ORDER BY avg_points DESC;
```

### Parlay Success Rate
```sql
-- How often do users get parlay bonuses?
SELECT 
  COUNT(DISTINCT wallet_address) as total_users,
  COUNT(DISTINCT CASE WHEN transaction_type LIKE 'parlay_%' 
    THEN wallet_address END) as users_with_parlays,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN transaction_type LIKE 'parlay_%' 
    THEN wallet_address END) / COUNT(DISTINCT wallet_address), 2) as parlay_rate
FROM user_point_transactions;
```
