# Clear User Predictions Script

This document explains how to use the `clear-user-predictions.ts` script to clear a user's predictions while preserving their points.

## Overview

The script performs the following actions:

1. Retrieves the encrypted admin keypair from the `global_params` table
2. Decrypts the keypair using the `SALT` environment variable
3. Reads the user's current predictions and points from the blockchain
4. Calls the `admin_clear_user_silos` instruction on the Solana program
5. Clears all 10 prediction silos (top & worst performers)
6. Resets all prediction timestamps to 0
7. **Preserves the user's points** (unchanged)
8. Verifies the predictions were cleared successfully with detailed logging

## Key Difference from Reset

- **`admin_reset_user`**: Clears predictions **AND resets points to 0**
- **`admin_clear_user_silos`**: Clears predictions **BUT preserves points** ✅

## Prerequisites

### 1. Environment Variables

Ensure your `.env` file has:

```bash
# Required
SALT=your_secret_salt_here
DATABASE_URL=your_database_connection_string
PROGRAM_ID=2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM

# Optional (defaults to mainnet)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

**Important**: The `PROGRAM_ID` is always read from the environment file to ensure consistency across all operations.

### 2. Admin Keypair Setup

The admin keypair must be properly stored and encrypted in the database. See `BUYBACK_KEY_SETUP.md` for setup instructions.

## Usage

### Basic Command

```bash
bun run scripts/clear-user-predictions.ts <user_address>
```

### Example

```bash
bun run scripts/clear-user-predictions.ts ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T
```

## Expected Output

```
============================================================
🧹 Clear User Predictions (Preserve Points)
============================================================
📅 Timestamp: 2024-12-20T10:30:45.123Z
🔧 Program ID: 2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM

🔓 Step 1: Retrieving admin keypair from database...
   ✅ Admin Public Key: J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo
   ⏱️  Time taken: 45ms

🔍 Step 2: Verifying admin keypair...
   ✅ Admin keypair verified

📡 Connection Details:
   RPC URL: https://api.mainnet-beta.solana.com
   Target User: ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T

🔑 Step 3: Deriving PDAs...
   Global State PDA: [derived address]
   User Predictions PDA: [derived address]

🔍 Step 4: Reading current user data from blockchain...
   ⏱️  Account fetch time: 234ms
   ✅ User account found
   📦 Account data size: 196 bytes

   📊 Current State:
   Points: 5000
   Top Performers: [BTC, ETH, SOL, DOGE, ADA]
   Worst Performers: [SHIB, PEPE, (empty), (empty), (empty)]

🔨 Step 5: Building transaction...
   📝 Instruction discriminator: 72ee6dd7f7ac3ce9
   ✅ Transaction instruction created

📤 Step 6: Sending transaction to Solana...
   ⏱️  Transaction build time: 12ms
   ⏱️  Transaction send time: 456ms
   📝 Transaction Signature: [signature]
   ⏳ Waiting for confirmation...
   ⏱️  Confirmation time: 2345ms

✅ Step 7: Transaction confirmed!
   🔗 Explorer: https://explorer.solana.com/tx/[signature]?cluster=mainnet

🔍 Step 8: Verifying predictions were cleared...
   ⏱️  Verification fetch time: 189ms

============================================================
🧹 Clear Predictions Summary:
============================================================
   Points (PRESERVED): 5000
   Top Performers: [(empty), (empty), (empty), (empty), (empty)]
   Worst Performers: [(empty), (empty), (empty), (empty), (empty)]
============================================================

🎉 Success! Predictions cleared and points preserved!
   ✅ All predictions cleared
   ✅ Points preserved: 5000
```

## Performance Metrics

The script tracks timing for each step:
- Keypair retrieval: ~45ms
- Account fetch: ~234ms
- Transaction build: ~12ms
- Transaction send: ~456ms
- Confirmation: ~2345ms
- Verification: ~189ms

**Total time**: ~3-4 seconds

## What Gets Cleared

When the script runs, it clears:

1. ✅ **All 5 Top Performer predictions** (set to empty)
2. ✅ **All 5 Worst Performer predictions** (set to empty)
3. ✅ **All 10 prediction timestamps** (set to 0)
4. ✅ **Updates `last_updated`** (set to current time)

What it **preserves**:

1. ✅ **User's points** (completely unchanged)

## Use Cases

### 1. New Round Reset
Clear predictions for a new round while preserving earned points:
```bash
bun run scripts/clear-user-predictions.ts <user_address>
```

### 2. Fix Incorrect Predictions
Admin can clear accidentally set predictions without affecting points:
```bash
bun run scripts/clear-user-predictions.ts <user_address>
```

### 3. Daily/Periodic Resets
Automate clearing predictions while maintaining point totals across rounds.

### 4. Bug Fixes
If predictions get corrupted but points are correct, clear and let user re-predict.

## Error Handling

### Common Errors

**Error: "PROGRAM_ID environment variable is required"**
- Solution: Add `PROGRAM_ID=2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM` to your `.env` file

**Error: "SALT environment variable is required"**
- Solution: Add `SALT` to your `.env` file

**Error: "User predictions account not found"**
- Issue: The user hasn't initialized their predictions account yet
- Solution: The user must initialize their predictions account first

**Error: "Admin keypair does not match"**
- Issue: The keypair in the database doesn't match the expected admin
- Solution: Verify the correct admin keypair is stored in the database

**Info: "All predictions are already empty"**
- This is not an error - the user's predictions are already cleared
- The script will exit gracefully without making any changes

## Technical Details

### Program Information

- **Program ID**: Read from `PROGRAM_ID` env variable (typically `2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM`)
- **Admin Authority**: `J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo`
- **Instruction**: `admin_clear_user_silos` (discriminator: `0x72ee6dd7f7ac3ce9`)

### Account Structure (UserPredictions)

```
Size: 196 bytes

Layout:
- discriminator: 8 bytes
- owner: 32 bytes (Pubkey)
- top_performer: 30 bytes (5 x 6-byte strings)
- worst_performer: 30 bytes (5 x 6-byte strings)
- top_performer_timestamps: 40 bytes (5 x i64)
- worst_performer_timestamps: 40 bytes (5 x i64)
- points: 8 bytes (u64) ← PRESERVED
- last_updated: 8 bytes (i64) ← Updated to now
```

### Security

- ✅ **Admin Only**: Only the authorized admin can execute this instruction
- ✅ **Encrypted Keypair**: Admin keypair is stored encrypted in the database
- ✅ **Verification**: Script verifies the admin keypair matches expected address
- ✅ **Read-First**: Always reads current state before clearing
- ✅ **Validation**: Confirms predictions are cleared and points preserved

## Comparison with Other Admin Scripts

| Script | Clears Predictions | Resets Points | Use Case |
|--------|-------------------|---------------|----------|
| `clear-user-predictions.ts` | ✅ | ❌ | Clear predictions, keep points |
| `reset_user.ts` (Anchor) | ✅ | ✅ | Full reset including points |
| `update-user-points.ts` | ❌ | Modifies | Update points only |

## Example Workflow

### Daily Round Reset (Preserve Points)

```bash
# At the start of each day, clear all predictions but keep points
for user in $(cat user_addresses.txt); do
  bun run scripts/clear-user-predictions.ts "$user"
  sleep 1  # Rate limiting
done
```

### Selective Clear (Single User)

```bash
# Clear a specific user's predictions
bun run scripts/clear-user-predictions.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
```

## Automation with Inngest

You could integrate this into an Inngest job for automated daily resets:

```typescript
// Pseudocode example
export const dailyPredictionReset = inngest.createFunction(
  { id: "daily-prediction-reset" },
  { cron: "0 0 * * *" }, // Every day at midnight
  async ({ step }) => {
    const users = await step.run("get-users", async () => {
      return await fetchAllActiveUsers();
    });
    
    await step.run("clear-predictions", async () => {
      for (const user of users) {
        await clearUserPredictionsOnChain(user.address);
        // Points preserved!
      }
    });
  }
);
```

## Safety Notes

1. **Points are preserved** - This is the key feature of this script
2. **Irreversible** - Once cleared, prediction history is lost (from blockchain)
3. **No confirmation prompt** - Script executes immediately
4. **Database snapshots** - User prediction history is preserved in `user_predictions_snapshots` table
5. **Rate limiting** - Be mindful of RPC rate limits when clearing multiple users

## Related Documentation

- `UPDATE_USER_POINTS.md` - For updating user points
- `BUYBACK_KEY_SETUP.md` - For admin keypair setup
- `USER_PREDICTIONS_FEATURE.md` - For understanding prediction structure
- `EXAMPLE_USAGE.md` - For point update examples

