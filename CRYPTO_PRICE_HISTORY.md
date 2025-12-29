# Crypto Price History Feature

## Overview

Added a new `crypto_price_history` table to track historical price data over time. This table accumulates data from every Inngest snapshot run and is never purged, providing a complete historical record of cryptocurrency prices and market data.

## Database Schema

### Table: `crypto_price_history`

Identical structure to `crypto_market_cache` but with different data retention:

```sql
CREATE TABLE "crypto_price_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "round_id" uuid NOT NULL,
    "coingecko_id" varchar(255) NOT NULL,
    "symbol" varchar(50) NOT NULL,
    "name" varchar(255) NOT NULL,
    "image_url" text,
    "current_price" numeric(20, 8) NOT NULL,
    "market_cap" numeric(30, 2),
    "market_cap_rank" integer,
    "total_volume" numeric(30, 2),
    "volume_rank" integer,
    "price_change_percentage_24h" numeric(10, 4) NOT NULL,
    "snapshot_timestamp" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
```

## Key Differences: Cache vs History

| Feature | `crypto_market_cache` | `crypto_price_history` |
|---------|----------------------|------------------------|
| **Purpose** | Current snapshot for UI | Historical data for analysis |
| **Data Retention** | Purged on each run | Never purged, accumulates |
| **Typical Size** | ~100-200 records | Grows indefinitely |
| **Use Case** | Fast UI queries | Trend analysis, charts, history |

## Inngest Process Changes

### Step 3: Populate Cache (Updated)

The Inngest `crypto-snapshot` job now performs **dual inserts** in Step 3:

```typescript
// 1. Purge and insert into cache (as before)
await db.execute(sql`TRUNCATE TABLE crypto_market_cache`);
await db.insert(cryptoMarketCache).values(cacheRecords);

// 2. Insert into history (NEW - never purged)
await db.insert(cryptoPriceHistory).values(cacheRecords);
```

**Console Output:**
```
   💾 Inserted 100 records into crypto_market_cache
   📊 Inserted 100 records into crypto_price_history
```

## Files Modified

1. **Schema Files:**
   - ✅ Created: `src/db/schema/crypto_price_history.ts`
   - ✅ Updated: `src/db/schema/index.ts` (added export)

2. **Inngest Process:**
   - ✅ Updated: `src/inngest/crypto-snapshot.ts`
     - Added `cryptoPriceHistory` import
     - Added insert statement in Step 3

3. **Database:**
   - ✅ Created: `drizzle/0010_create_crypto_price_history.sql`
   - ✅ Table created in production database

## Usage Examples

### Query Recent Price History

```typescript
import { db } from "./db";
import { cryptoPriceHistory } from "./db/schema";
import { eq, desc } from "drizzle-orm";

// Get last 24 hours of BTC price data
const btcHistory = await db
  .select()
  .from(cryptoPriceHistory)
  .where(eq(cryptoPriceHistory.symbol, 'btc'))
  .orderBy(desc(cryptoPriceHistory.snapshotTimestamp))
  .limit(24); // If running hourly
```

### Get Price Trend for a Coin

```typescript
// Get all historical data for Ethereum
const ethTrend = await db
  .select({
    timestamp: cryptoPriceHistory.snapshotTimestamp,
    price: cryptoPriceHistory.currentPrice,
    change24h: cryptoPriceHistory.priceChangePercentage24h,
  })
  .from(cryptoPriceHistory)
  .where(eq(cryptoPriceHistory.coingeckoId, 'ethereum'))
  .orderBy(cryptoPriceHistory.snapshotTimestamp);
```

### Compare Prices Across Rounds

```typescript
// Get price data for multiple rounds
const pricesByRound = await db
  .select()
  .from(cryptoPriceHistory)
  .where(
    inArray(cryptoPriceHistory.roundId, [roundId1, roundId2, roundId3])
  );
```

## Data Growth Estimation

With the current configuration:

- **Snapshot Frequency:** Every 2 minutes (from `.env`)
- **Coins per Snapshot:** ~100 coins
- **Records per Hour:** 100 coins × 30 snapshots = 3,000 records
- **Records per Day:** 3,000 × 24 = 72,000 records
- **Records per Month:** ~2.16 million records

### Storage Considerations

- Each record: ~200-300 bytes
- Daily storage: ~14-21 MB
- Monthly storage: ~430-650 MB
- Yearly storage: ~5-8 GB

**Recommendation:** Consider adding indexes on frequently queried columns:
- `coingecko_id` + `snapshot_timestamp`
- `symbol` + `snapshot_timestamp`
- `round_id`

## Future Enhancements

Potential use cases for this historical data:

1. **Price Charts:** Display 24h/7d/30d price trends
2. **Volatility Analysis:** Calculate historical volatility
3. **Performance Analytics:** Track which coins are consistently top/worst performers
4. **User Insights:** Show users how their predictions compared to actual trends
5. **Market Correlation:** Analyze relationships between different coins
6. **Prediction Accuracy:** Compare user predictions against actual historical performance

## Maintenance

### Data Cleanup (Optional)

If storage becomes a concern, you can implement data retention policies:

```sql
-- Delete records older than 90 days
DELETE FROM crypto_price_history 
WHERE snapshot_timestamp < NOW() - INTERVAL '90 days';
```

### Indexing (Recommended)

```sql
-- Add indexes for common queries
CREATE INDEX idx_crypto_price_history_symbol_timestamp 
ON crypto_price_history(symbol, snapshot_timestamp DESC);

CREATE INDEX idx_crypto_price_history_coingecko_timestamp 
ON crypto_price_history(coingecko_id, snapshot_timestamp DESC);

CREATE INDEX idx_crypto_price_history_round 
ON crypto_price_history(round_id);
```

## Testing

The table is automatically populated on every Inngest run. To verify:

1. Check the Inngest logs for the insert message:
   ```
   📊 Inserted X records into crypto_price_history
   ```

2. Query the table:
   ```sql
   SELECT COUNT(*) FROM crypto_price_history;
   SELECT COUNT(DISTINCT round_id) FROM crypto_price_history;
   SELECT MIN(snapshot_timestamp), MAX(snapshot_timestamp) FROM crypto_price_history;
   ```

## Summary

✅ **Completed:**
- Created `crypto_price_history` table schema
- Updated Inngest process to dual-insert data
- Created database table
- No breaking changes to existing functionality

🎯 **Benefits:**
- Historical price tracking without API calls
- Foundation for analytics features
- No impact on existing cache behavior
- Automatic population via Inngest


