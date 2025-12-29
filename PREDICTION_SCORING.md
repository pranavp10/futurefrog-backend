# Prediction Scoring System (Accuracy-Based)

## Overview

The scoring system awards points based on how accurately users predict percentage price changes. Each prediction is an independent bet - the 5 slots in each category (top_performer/worst_performer) are simply 5 separate opportunities to make predictions.

## How Predictions Work

1. **User makes a prediction**: Chooses a coin + predicted % change
   - `top_performer`: User predicts the coin will go **UP** by X%
   - `worst_performer`: User predicts the coin will go **DOWN** by X%

2. **At scoring time**: 
   - Fetch current price from CoinGecko
   - Calculate actual % change
   - Compare predicted vs actual percentage

## Scoring Logic

### Step 1: Direction Check

First, check if the user predicted the correct direction:

| Category | Expected | Actual Movement | Result |
|----------|----------|-----------------|--------|
| top_performer | UP (+%) | Price went UP | ✓ Correct |
| top_performer | UP (+%) | Price went DOWN | ✗ Wrong |
| worst_performer | DOWN (-%) | Price went DOWN | ✓ Correct |
| worst_performer | DOWN (-%) | Price went UP | ✗ Wrong |

**Wrong direction = 10 points (participation)**

### Step 2: Accuracy Score (if direction correct)

Calculate **error** = `|predicted% - actual%|`

| Error Range | Points | Label |
|-------------|--------|-------|
| 0 - 1% | **1000** | Perfect |
| 1 - 2% | **750** | Excellent |
| 2 - 5% | **500** | Great |
| 5 - 10% | **250** | Good |
| 10 - 20% | **100** | Fair |
| > 20% | **50** | Correct Direction |

## Example Scenarios

### Scenario 1: Perfect Prediction
- User predicts: BTC will go UP by **+4.5%**
- Actual: BTC went UP by **+4.8%**
- Error: |4.5 - 4.8| = 0.3%
- **Points: 1000** (Perfect tier)

### Scenario 2: Great Prediction
- User predicts: ETH will go UP by **+8%**
- Actual: ETH went UP by **+5%**
- Error: |8 - 5| = 3%
- **Points: 500** (Great tier)

### Scenario 3: Wrong Direction
- User predicts: SOL will go DOWN by **-3%** (worst_performer)
- Actual: SOL went UP by **+2%**
- Direction wrong!
- **Points: 10** (Participation)

### Scenario 4: Right Direction, Way Off
- User predicts: DOGE will go DOWN by **-2%**
- Actual: DOGE went DOWN by **-25%**
- Error: |2 - 25| = 23%
- **Points: 50** (Correct direction but very off)

## Points Range Per Round

- **Maximum**: 10 bets × 1000 points = **10,000 points**
- **Minimum**: 10 bets × 10 points = **100 points** (all wrong directions)

## Database Schema

### user_predictions_snapshots columns

| Column | Type | Description |
|--------|------|-------------|
| `predicted_percentage` | integer | User's predicted % change (from blockchain) |
| `price_at_prediction` | decimal | Price when prediction was made |
| `price_at_scoring` | decimal | Price when prediction was scored |
| `actual_percentage` | decimal | Actual % change at scoring |
| `points_earned` | integer | Points awarded for this prediction |
| `processed` | boolean | Whether prediction has been scored |

### Transaction Types (user_point_transactions)

| Type | Points | Description |
|------|--------|-------------|
| `accuracy_perfect` | 1000 | 0-1% error |
| `accuracy_excellent` | 750 | 1-2% error |
| `accuracy_great` | 500 | 2-5% error |
| `accuracy_good` | 250 | 5-10% error |
| `accuracy_fair` | 100 | 10-20% error |
| `accuracy_correct_direction` | 50 | >20% error, right direction |
| `accuracy_wrong_direction` | 10 | Wrong direction |

## Process Flow

1. **Inngest cron runs** (every X minutes)
2. **Find eligible predictions**: 
   - `processed = false`
   - `snapshotTimestamp < cutoff` (older than interval)
3. **Fetch current prices** from CoinGecko
4. **Score each prediction**:
   - Check direction
   - Calculate error
   - Assign points based on accuracy tier
5. **Update database**:
   - Set `points_earned`, `price_at_scoring`, `actual_percentage`
   - Mark `processed = true`
6. **Update blockchain**: Add points to user's account
7. **Record transactions**: Create audit trail in `user_point_transactions`
8. **Clear predictions**: Reset user silos for next round

## Configuration

### Environment Variables

- `PREDICTION_INTERVAL_MINUTES` (default: 60)
  - Minimum age for predictions to be eligible for scoring

- `PROGRAM_ID` (required)
  - Solana program ID for updating user points

- `SOLANA_RPC_URL` (default: mainnet)
  - RPC endpoint for blockchain transactions

## API Endpoints

### GET /user-predictions/:walletAddress/stats

Returns accuracy breakdown for a user:

```json
{
  "walletAddress": "...",
  "currentPoints": 15000,
  "totalPredictions": 50,
  "totalPointsEarned": 12500,
  "accuracyTiers": {
    "perfect": 5,
    "excellent": 8,
    "great": 15,
    "good": 10,
    "fair": 7,
    "correctDirection": 3,
    "wrongDirection": 2
  },
  "correctDirectionTotal": 48,
  "directionAccuracy": "96.00",
  "averagePoints": "250.00"
}
```

## Migration

Run the migration to add new columns:

```bash
npx drizzle-kit push
# or
psql $DATABASE_URL -f drizzle/0011_add_prediction_percentage_columns.sql
```


