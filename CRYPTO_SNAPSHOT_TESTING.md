# Crypto Snapshot Job - Testing Guide

## Prerequisites

1. **Add Environment Variables**: Add the following to your `.env` file:
   ```env
   CRYPTO_SNAPSHOT_ON=true                    # Set to "true" to enable scheduled runs
   CRYPTO_SNAPSHOT_FREQUENCY_MINUTES=15       # How often to run (in minutes)
   ```

   **Note**: Set `CRYPTO_SNAPSHOT_ON=false` if you only want to trigger snapshots manually via the API endpoint.

2. **Apply Database Migration**: When you have database access, run:
   ```bash
   bun run db:push
   # or
   bun run db:migrate
   ```

## Testing Steps

### 1. Start the Backend Server

```bash
cd /Users/moreshkokane/code/futurefrog-backend
bun run dev
```

The server should start on port 8000 (or the port specified in your .env).

### 2. Start the Inngest Dev Server

In a separate terminal:

```bash
cd /Users/moreshkokane/code/futurefrog-backend
npx inngest-cli@latest dev -u http://localhost:8000/inngest
```

This will:
- Open the Inngest Dev UI at `http://localhost:8288`
- Connect to your backend's `/inngest` endpoint
- Discover all registered functions (including `crypto-snapshot`)

### 3. Verify Function Registration

1. Open `http://localhost:8288` in your browser
2. Navigate to the "Functions" tab
3. You should see two functions:
   - `hello-world`
   - `crypto-snapshot` (with cron schedule)

### 4. Trigger the Snapshot Job Manually

There are two ways to test the job:

#### Option A: Via Inngest UI (Recommended)

1. In the Inngest UI at `http://localhost:8288`
2. Click on the `crypto-snapshot` function
3. Click the "Test Run" or "Invoke" button
4. The function will execute immediately

#### Option B: Programmatically (if needed)

Create a test script or use the Inngest client:

```typescript
import { inngest } from "./src/inngest/client";

await inngest.send({
    name: "crypto/snapshot",
    data: {}
});
```

### 5. Monitor Execution

Watch the Inngest UI for:
- **Function execution status** - should show "Running" then "Completed"
- **Steps executed**:
  - `fetch-coingecko-data` - Fetches from CoinGecko API
  - `filter-and-rank` - Applies filters and sorts by 24h change
  - `insert-to-database` - Inserts 10 records into database
- **Execution logs** - Check for console output

Also watch your backend terminal for log messages:
```
🐸 [Crypto Snapshot] Starting round <uuid> at <timestamp>
   📊 Fetched 200 coins from CoinGecko
   ✅ Filtered to ~100 coins
   🚀 Top gainer: <coin name> (<percentage>%)
   📉 Worst performer: <coin name> (<percentage>%)
   💾 Inserted 10 records to database
✅ [Crypto Snapshot] Round <uuid> completed successfully
```

### 6. Verify Database Records

Query the database to verify 10 records were inserted:

```sql
SELECT 
    round_id,
    performance_category,
    performance_rank,
    symbol,
    name,
    price_change_percentage_24h,
    snapshot_timestamp
FROM crypto_performance_logs
ORDER BY snapshot_timestamp DESC, performance_category, performance_rank
LIMIT 10;
```

**Expected Results**:
- 10 rows with the same `round_id`
- 5 rows with `performance_category = 'top_gainer'` (ranks 0-4)
- 5 rows with `performance_category = 'worst_performer'` (ranks 0-4)
- Top gainers should have higher (more positive) `price_change_percentage_24h`
- Worst performers should have lower (more negative) `price_change_percentage_24h`
- All 10 rows should have the same `snapshot_timestamp`

### 7. Test Scheduled Execution

The cron job will run automatically every X minutes (based on `CRYPTO_SNAPSHOT_FREQUENCY_MINUTES`).

To test the schedule:
1. Keep both servers running (backend + Inngest dev)
2. Wait for the scheduled time
3. Check the Inngest UI for new executions
4. Verify new records are inserted with a new `round_id`

**Note**: With `CRYPTO_SNAPSHOT_FREQUENCY_MINUTES=15`, the job runs at:
- `:00`, `:15`, `:30`, `:45` of each hour

To test more frequently, temporarily change it to `5` or `1` minute.

### 8. Verify Data Quality

Check that the filtering is working correctly:

```sql
-- Should NOT contain any stablecoins or wrapped assets
SELECT DISTINCT symbol, name 
FROM crypto_performance_logs 
WHERE symbol ILIKE '%usd%' 
   OR symbol ILIKE '%usdt%'
   OR symbol ILIKE 'w%'
   OR name ILIKE '%wrapped%'
   OR name ILIKE '%staked%';
```

This query should return 0 rows if filtering is working correctly.

### 9. Check for Errors

If the job fails, check:

1. **CoinGecko API**:
   - Is `COINGECKO_API_KEY` set in `.env`?
   - Are you hitting rate limits?
   - Check CoinGecko API status

2. **Database Connection**:
   - Is `DATABASE_URL` correct in `.env`?
   - Can you connect to the database?
   - Are tables created?

3. **Inngest Connection**:
   - Is the backend server running?
   - Is `/inngest` endpoint accessible?
   - Check Inngest logs in the UI

## Sample Data

After a successful run, you should see data like:

| round_id | category | rank | symbol | name | price_change_24h |
|----------|----------|------|--------|------|------------------|
| uuid-123 | top_gainer | 0 | COIN1 | Coin One | 45.23 |
| uuid-123 | top_gainer | 1 | COIN2 | Coin Two | 38.67 |
| uuid-123 | top_gainer | 2 | COIN3 | Coin Three | 32.11 |
| uuid-123 | top_gainer | 3 | COIN4 | Coin Four | 28.45 |
| uuid-123 | top_gainer | 4 | COIN5 | Coin Five | 25.89 |
| uuid-123 | worst_performer | 0 | COIN6 | Coin Six | -35.67 |
| uuid-123 | worst_performer | 1 | COIN7 | Coin Seven | -28.43 |
| uuid-123 | worst_performer | 2 | COIN8 | Coin Eight | -22.19 |
| uuid-123 | worst_performer | 3 | COIN9 | Coin Nine | -18.76 |
| uuid-123 | worst_performer | 4 | COIN10 | Coin Ten | -15.32 |

## Troubleshooting

### Function Not Showing in Inngest UI

- Restart both backend and Inngest dev servers
- Check backend logs for Inngest registration errors
- Verify `/inngest` endpoint is accessible: `curl http://localhost:8000/inngest`

### Database Insert Fails

- Verify table exists: `\d crypto_performance_logs` in psql
- Check database connection in backend logs
- Verify DATABASE_URL in .env

### CoinGecko API Errors

- Check rate limits (free tier: 10-50 calls/minute)
- Verify API key is valid
- Check CoinGecko service status

## Clean Up Test Data (Optional)

To remove test data:

```sql
DELETE FROM crypto_performance_logs 
WHERE snapshot_timestamp < NOW() - INTERVAL '1 day';
```

Or delete specific test rounds:

```sql
DELETE FROM crypto_performance_logs 
WHERE round_id = '<specific-round-id>';
```



