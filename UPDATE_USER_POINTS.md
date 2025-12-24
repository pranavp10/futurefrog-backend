# Update User Points Script

This document explains how to use the `update-user-points.ts` script to add points to a user's account on the Solana program using the admin keypair.

## Overview

The script performs the following operations:
1. Retrieves the admin keypair from the `global_params` table (encrypted)
2. Decrypts the keypair using the `SALT` environment variable
3. Reads the user's current points from the blockchain
4. Adds the specified amount to the current points
5. Calls the `update_user_points` instruction on the Solana program
6. Verifies the points were updated successfully with detailed logging

## Prerequisites

### 1. Environment Setup

Make sure your `.env` file contains the required variables:

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

The admin keypair must be stored in the `global_params` table with the title `buy_back_key_v2`. This is the same keypair used for buyback operations since the admin public key (`J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo`) matches the buyback wallet.

Verify the keypair is set up correctly:

```bash
bun run scripts/verify-buyback-key.ts
```

## Usage

### Basic Command

```bash
bun run scripts/update-user-points.ts <user_address> <points_to_add>
```

### Parameters

- `user_address` - The Solana public key of the user (base58 encoded)
- `points_to_add` - The number of points to add to the current balance (can be positive or negative)

### Examples

**Add 1000 bonus points to a user:**
```bash
bun run scripts/update-user-points.ts ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T 1000
```

**Add 500 points:**
```bash
bun run scripts/update-user-points.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM 500
```

**Subtract 100 points (penalty):**
```bash
bun run scripts/update-user-points.ts 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM -100
```

**Note:** The script reads the current points first, then adds the specified amount. It will prevent setting negative points.

## Output

The script provides detailed output with comprehensive logging during execution:

```
============================================================
🎯 Update User Points (Add Points)
============================================================
📅 Timestamp: 2024-12-19T10:30:45.123Z
🔧 Program ID: 2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM

🔓 Step 1: Retrieving admin keypair from database...
   ✅ Admin Public Key: J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo
   ⏱️  Time taken: 45ms

🔍 Step 2: Verifying admin keypair...
   ✅ Admin keypair verified

📡 Connection Details:
   RPC URL: https://api.mainnet-beta.solana.com
   Target User: ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T
   Points to Add: +1000

🔑 Step 3: Deriving PDAs...
   Global State PDA: ...
   User Predictions PDA: ...

🔍 Step 4: Reading current user data from blockchain...
   ⏱️  Account fetch time: 234ms
   ✅ User account found
   📦 Account data size: 196 bytes
   📊 Current Points: 5000
   🎯 New Points After Addition: 6000
   📈 Change: 5000 + 1000 = 6000

🔨 Step 5: Building transaction...
   📝 Instruction discriminator: 4004b87e002ec49f
   📝 Points data (hex): 7017000000000000
   ✅ Transaction instruction created

📤 Step 6: Sending transaction to Solana...
   ⏱️  Transaction build time: 12ms
   ⏱️  Transaction send time: 456ms
   📝 Transaction Signature: ...
   ⏳ Waiting for confirmation...
   ⏱️  Confirmation time: 2345ms

✅ Step 7: Transaction confirmed!
   🔗 Explorer: https://explorer.solana.com/tx/...

🔍 Step 8: Verifying points update...
   ⏱️  Verification fetch time: 189ms

============================================================
🎯 Points Update Summary:
   Before: 5000
   Change: +1000
   After:  6000
   Expected: 6000
============================================================

🎉 Success! Points updated correctly!
   ✅ Verification passed: 6000 === 6000
```

## Error Handling

### Common Errors

**Error: "PROGRAM_ID environment variable is required"**
- Solution: Add `PROGRAM_ID=2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM` to your `.env` file

**Error: "SALT environment variable is required"**
- Solution: Add `SALT` to your `.env` file

**Error: "User predictions account not found"**
- Solution: The user must initialize their predictions account first

**Error: "Invalid user address"**
- Solution: Verify the user address is a valid Solana public key

**Error: "Cannot set negative points"**
- Solution: The calculated points would be negative. Current points + points to add must be >= 0

**Error: "Retrieved keypair does not match expected admin"**
- Solution: Verify the correct admin keypair is stored in the database

**Error: "Insufficient SOL for transaction fees"**
- Solution: Ensure the admin wallet has enough SOL for transaction fees (typically ~0.000005 SOL)

## Technical Details

### Program Information

- **Program ID**: Read from `PROGRAM_ID` env variable (typically `2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM`)
- **Admin Authority**: `J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo`
- **Instruction**: `update_user_points` (discriminator: `0x4004b87e002ec49f`)

### Points Calculation

The script performs **additive updates**, not absolute sets:
- Reads current points from the blockchain
- Adds the specified amount (can be positive or negative)
- Validates the result is non-negative
- Updates the on-chain account with the new total

### PDA Derivation

- **Global State PDA**: `["global_state"]`
- **User Predictions PDA**: `["user_predictions", user_pubkey]`

### Data Layout

The user account stores points at offset: `8 (discriminator) + 32 (owner) + 140 (other fields) = 180 bytes`

Points are stored as a `u64` (8 bytes) in little-endian format.

## Security Notes

1. **SALT Protection**: Never commit the `SALT` to version control
2. **Admin Keypair**: The admin keypair is encrypted and only decrypted at runtime
3. **Transaction Signing**: All transactions are signed with the admin keypair
4. **Verification**: The script verifies the keypair matches the expected admin before proceeding

## Integration with Backend

This script can be called programmatically from other Node.js/Bun scripts:

```typescript
import { execSync } from 'child_process';

function addUserPoints(userAddress: string, pointsToAdd: number) {
    const cmd = `bun run scripts/update-user-points.ts ${userAddress} ${pointsToAdd}`;
    execSync(cmd, { stdio: 'inherit' });
}

// Example: Add 1000 bonus points
addUserPoints('ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T', 1000);

// Example: Apply -50 penalty
addUserPoints('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', -50);
```

## Related Scripts

- `scripts/verify-buyback-key.ts` - Verify admin keypair setup
- `scripts/insert-buyback-key.ts` - Insert/update admin keypair in database
- `scripts/example-usage.ts` - Example of using buyback utilities

## Support

For issues or questions:
- Check that all prerequisites are met
- Verify environment variables are correctly set
- Ensure the user account exists on-chain
- Check Solana Explorer for transaction details

