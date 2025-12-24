# Example: Adding 1000 Points to a User

This document shows an example of using the `update-user-points.ts` script to add 1000 points to a specific user.

## Command

```bash
bun run scripts/update-user-points.ts ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T 1000
```

## What Happens

### Step-by-Step Process

1. **Keypair Retrieval** (Step 1-2)
   - Retrieves encrypted admin keypair from `global_params` table
   - Decrypts using SALT environment variable
   - Verifies the keypair matches expected admin: `J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo`

2. **Connection Setup**
   - Uses PROGRAM_ID from env: `2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM`
   - Connects to Solana RPC (mainnet by default)
   - Target user: `ALtVPTz6Aj7FQ7T74LvASohejovHCTN73ia2hkWEXd6T`

3. **PDA Derivation** (Step 3)
   - Derives Global State PDA from seed `["global_state"]`
   - Derives User Predictions PDA from seed `["user_predictions", user_pubkey]`

4. **Read Current Points** (Step 4)
   - Fetches user account data from blockchain
   - Reads current points value at offset 180 bytes
   - Example: If user has 5000 points currently
   - Calculates: 5000 + 1000 = 6000 new points
   - Validates result is non-negative

5. **Build Transaction** (Step 5)
   - Creates instruction with discriminator `0x4004b87e002ec49f`
   - Encodes new points (6000) as u64 little-endian
   - Sets up accounts: [user_predictions_pda, global_state_pda, admin_signer]

6. **Send Transaction** (Step 6)
   - Gets latest blockhash
   - Signs transaction with admin keypair
   - Sends to Solana network
   - Returns transaction signature

7. **Confirm Transaction** (Step 7)
   - Waits for transaction confirmation
   - Provides Solana Explorer link

8. **Verify Update** (Step 8)
   - Fetches updated account data
   - Reads new points value
   - Verifies: new points (6000) === expected (6000)
   - Shows before/after summary

## Expected Output

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
   Global State PDA: [derived address]
   User Predictions PDA: [derived address]

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
   📝 Transaction Signature: [signature]
   ⏳ Waiting for confirmation...
   ⏱️  Confirmation time: 2345ms

✅ Step 7: Transaction confirmed!
   🔗 Explorer: https://explorer.solana.com/tx/[signature]?cluster=mainnet

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

## Performance Metrics

The script tracks timing for each step:
- Keypair retrieval: ~45ms
- Account fetch: ~234ms
- Transaction build: ~12ms
- Transaction send: ~456ms
- Confirmation: ~2345ms
- Verification: ~189ms

**Total time**: ~3-4 seconds

## Key Features

✅ **Additive Logic**: Adds points instead of setting absolute value  
✅ **Read-First**: Always reads current points before updating  
✅ **Validation**: Prevents negative points  
✅ **Detailed Logging**: Shows every step with timing  
✅ **Verification**: Confirms points updated correctly  
✅ **Environment-Based**: Uses PROGRAM_ID from .env file  
✅ **Secure**: Admin keypair encrypted in database  

## Use Cases

1. **Bonus Points**: Award users for special events
   ```bash
   bun run scripts/update-user-points.ts <user> 1000
   ```

2. **Penalties**: Deduct points for violations
   ```bash
   bun run scripts/update-user-points.ts <user> -100
   ```

3. **Corrections**: Fix point calculation errors
   ```bash
   bun run scripts/update-user-points.ts <user> 50
   ```

## Prerequisites

Ensure your `.env` file has:
```bash
SALT=your_secret_salt
DATABASE_URL=your_database_url
PROGRAM_ID=2yAxvbLUuzNYjGiL3RPzjt8qjWGEGX5UJMm1FmA1WajM
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # optional
```

