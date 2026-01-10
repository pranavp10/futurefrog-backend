# Positions Backfill Script

A standalone script to backfill user prediction market positions using the DFlow API.

## Usage

```bash
# Backfill positions for a specific wallet
bun run scripts/backfill-trades.ts <publicKey>

# Backfill positions for multiple wallets
bun run scripts/backfill-trades.ts <publicKey1> <publicKey2> ...

# Backfill all wallets that have existing bets in the database
bun run scripts/backfill-trades.ts --all
```

## How it works (DFlow API approach)

1. **Fetch Token-2022 accounts** - Gets all Token-2022 token accounts owned by the wallet
2. **Filter outcome mints** - Uses `/api/v1/filter_outcome_mints` to identify prediction market tokens
3. **Get market details** - Uses `/api/v1/markets/batch` to fetch market metadata in batch
4. **Insert positions** - Stores positions in `user_bets` table (skips duplicates)

## Environment Variables Required

- `SOLANA_RPC_URL` - Solana RPC URL (Helius recommended)
- `DATABASE_URL` - PostgreSQL connection string

## Note

This script fetches **current positions** (tokens the wallet currently holds), not historical trades.
Entry price and invested amount will be stored as 0 since this data isn't available from positions alone.

