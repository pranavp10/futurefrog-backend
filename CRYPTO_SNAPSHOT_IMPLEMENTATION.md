# Crypto Performance Snapshot - Implementation Summary

## Overview

A scheduled Inngest job that periodically fetches CoinGecko data, identifies the top 5 crypto gainers and worst 5 performers, and stores them in a PostgreSQL database.

## What Was Implemented

### 1. Database Schema
**File**: `src/db/schema/crypto_performance_logs.ts`

New table `crypto_performance_logs` with columns:
- `id` - Primary key (UUID)
- `round_id` - Groups 10 records from the same API call (UUID)
- `coingecko_id`, `symbol`, `name`, `image_url` - Coin identification
- `current_price`, `market_cap`, `total_volume` - Market data
- `market_cap_rank`, `volume_rank` - Ranking data
- `price_change_percentage_24h` - Performance metric
- `performance_category` - "top_gainer" or "worst_performer"
- `performance_rank` - 0-4 (position within category)
- `snapshot_timestamp` - When CoinGecko data was received
- `created_at` - Record creation time

### 2. Shared Filter Logic
**File**: `src/lib/crypto-filters.ts`

Extracted reusable filter functions:
- `isStablecoin()` - Pattern-based stablecoin detection
- `isDerivativeAsset()` - Detects wrapped/staked/derivative assets
- `filterAndRankCryptos()` - Applies all filters and assigns volume ranks
- `getFilteringStats()` - Provides filtering statistics for logging

Excludes:
- 50+ known stablecoins (USDT, USDC, DAI, etc.)
- 30+ wrapped/staked assets (WBTC, stETH, etc.)
- Pattern-matched derivatives

### 3. Refactored API Endpoint
**File**: `src/routes/crypto-movers.ts`

Updated to use shared filter functions from `src/lib/crypto-filters.ts`.
Maintains same behavior but with centralized logic.

### 4. Inngest Scheduled Job
**File**: `src/inngest/crypto-snapshot.ts`

Scheduled function that:
1. Runs on a cron schedule (configurable via env variable)
2. Fetches top 200 coins by volume from CoinGecko
3. Applies shared filters (excludes stablecoins and derivatives)
4. Sorts by 24h price change percentage
5. Extracts top 5 gainers and bottom 5 losers
6. Generates unique `round_id` for the batch
7. Inserts 10 records into database

**File**: `src/inngest/types.ts`
- Added `CryptoSnapshotEvent` type for manual triggering

**File**: `src/inngest/index.ts`
- Exported `cryptoSnapshot` function

### 5. Environment Configuration
**Location**: `.env` (you need to add)

```env
CRYPTO_SNAPSHOT_FREQUENCY_MINUTES=15
```

Controls how often the cron job runs (default: 15 minutes).

### 6. Database Migration
**Generated**: `drizzle/0001_superb_mathemanic.sql`

Migration file has been created. Apply with:
```bash
bun run db:push
# or
bun run db:migrate
```

## Architecture

```
Inngest Cron (every X minutes)
    ↓
Fetch CoinGecko API (top 200 by volume)
    ↓
Apply Filters (exclude stablecoins/derivatives)
    ↓
Sort by 24h Price Change %
    ↓
Extract Top 5 Gainers + Worst 5 Performers
    ↓
Generate round_id + timestamp
    ↓
Insert 10 Records into crypto_performance_logs
```

## Data Flow Example

Each execution creates 10 database records:

**Round ID**: `a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6`
**Snapshot Timestamp**: `2025-01-15 10:30:00`

| Category | Rank | Symbol | Price Change 24h |
|----------|------|--------|------------------|
| top_gainer | 0 | BTC | +12.5% |
| top_gainer | 1 | ETH | +10.3% |
| top_gainer | 2 | SOL | +9.8% |
| top_gainer | 3 | AVAX | +8.2% |
| top_gainer | 4 | MATIC | +7.1% |
| worst_performer | 0 | XRP | -15.3% |
| worst_performer | 1 | ADA | -12.8% |
| worst_performer | 2 | DOT | -11.2% |
| worst_performer | 3 | LINK | -9.5% |
| worst_performer | 4 | UNI | -8.7% |

## Key Features

1. **Consistent Filtering**: Same logic as the `/api/crypto-movers` endpoint
2. **Round Identification**: Each execution generates a new UUID to group records
3. **Configurable Frequency**: Adjust via environment variable
4. **Comprehensive Logging**: Console logs at each step for debugging
5. **Error Handling**: Inngest's built-in retry and error handling
6. **Manual Triggering**: Can test via Inngest UI or programmatically

## Testing

See `CRYPTO_SNAPSHOT_TESTING.md` for detailed testing instructions.

Quick start:
1. Add `CRYPTO_SNAPSHOT_FREQUENCY_MINUTES=15` to `.env`
2. Run `bun run dev` (backend server)
3. Run `npx inngest-cli@latest dev -u http://localhost:8000/inngest`
4. Open `http://localhost:8288` and trigger the job
5. Verify 10 records inserted in database

## Files Changed/Created

### New Files
- `src/db/schema/crypto_performance_logs.ts` - Database schema
- `src/lib/crypto-filters.ts` - Shared filter logic
- `src/inngest/crypto-snapshot.ts` - Scheduled job
- `drizzle/0001_superb_mathemanic.sql` - Migration file
- `CRYPTO_SNAPSHOT_TESTING.md` - Testing guide
- `CRYPTO_SNAPSHOT_IMPLEMENTATION.md` - This file

### Modified Files
- `src/db/schema/index.ts` - Added export for new schema
- `src/routes/crypto-movers.ts` - Refactored to use shared filters
- `src/inngest/types.ts` - Added CryptoSnapshotEvent type
- `src/inngest/index.ts` - Exported cryptoSnapshot function

## Environment Variables Required

```env
# Existing (already in your .env)
DATABASE_URL=postgresql://...
COINGECKO_API_KEY=your_key_here

# New (you need to add)
CRYPTO_SNAPSHOT_ON=true                    # Set to "true" to enable scheduled snapshots, "false" to disable
CRYPTO_SNAPSHOT_FREQUENCY_MINUTES=15       # How often to run (in minutes)
```

## Environment Variables Explained

### CRYPTO_SNAPSHOT_ON
Controls whether the scheduled Inngest job runs automatically.

- `true` - Enables automatic scheduled snapshots (runs every X minutes)
- `false` or not set - Disables automatic scheduling (only manual triggers via API)

**Use Cases:**
- Set to `true` in production to capture regular snapshots
- Set to `false` in development to prevent automatic runs
- Set to `false` if you only want to trigger snapshots manually

### CRYPTO_SNAPSHOT_FREQUENCY_MINUTES
Defines how often the snapshot runs (only when `CRYPTO_SNAPSHOT_ON=true`).

## Cron Schedule Examples

The cron expression is: `*/${CRYPTO_SNAPSHOT_FREQUENCY_MINUTES} * * * *`

| Minutes | Cron Expression | When it Runs |
|---------|----------------|--------------|
| 1 | `*/1 * * * *` | Every minute |
| 5 | `*/5 * * * *` | :00, :05, :10, :15, etc. |
| 15 | `*/15 * * * *` | :00, :15, :30, :45 |
| 30 | `*/30 * * * *` | :00, :30 |
| 60 | `*/60 * * * *` | Top of every hour |

## Production Considerations

1. **Rate Limits**: CoinGecko free tier has limits (~10-50 calls/min)
2. **Database Growth**: 10 records per execution = 40/hour = 960/day
3. **Cleanup Strategy**: Consider archiving old data periodically
4. **Monitoring**: Use Inngest's monitoring in production
5. **Error Alerts**: Configure Inngest alerts for failures
6. **API Key**: Ensure COINGECKO_API_KEY is set for better rate limits

## Future Enhancements

Potential improvements:
- Add database indexes on `round_id`, `snapshot_timestamp`
- Create API endpoint to query historical snapshots
- Add trend analysis (compare snapshots over time)
- Send notifications for extreme market movements
- Store additional metrics (trading volume, market cap changes)
- Add data retention policy (auto-delete old records)

## Support

For issues or questions:
- Check logs in backend terminal
- Review Inngest UI for function execution details
- Verify database connectivity and schema
- Consult `CRYPTO_SNAPSHOT_TESTING.md` for troubleshooting



