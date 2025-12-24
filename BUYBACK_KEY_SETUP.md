# Buyback Key Encryption Setup

This document explains how the encrypted buyback key system works in the futurefrog-backend.

## Overview

The buyback private key is stored encrypted in the `global_params` database table using AES-256-CBC encryption. This follows the same secure pattern used in klout-backend-v3.

## Security Architecture

- **Encryption Algorithm**: AES-256-CBC
- **Key Derivation**: SHA-256 hash of the `SALT` environment variable
- **Storage**: Encrypted keypair stored in `global_params.param_value` with `param_title = 'buy_back_key_v2'`
- **Decryption**: Requires the `SALT` environment variable to decrypt at runtime

## Setup Steps

### 1. Environment Configuration

Make sure your `.env` file contains the `SALT` variable:

```bash
SALT=your_secret_salt_here
```

**⚠️ IMPORTANT**: Never commit the `SALT` to version control. Keep it secure!

### 2. Database Setup

The `global_params` table is defined in the schema and created via migration:

```bash
bun run db:generate  # Generate migration
bun run db:migrate   # Apply migration to database
```

### 3. Insert Encrypted Buyback Key

Run the script to insert the encrypted buyback key into the database:

```bash
bun run scripts/insert-buyback-key.ts
```

This will:
- Insert/update the `buy_back_key_v2` parameter in `global_params`
- Store the encrypted keypair value

### 4. Verify Setup

Test that everything is working correctly:

```bash
bun run scripts/verify-buyback-key.ts
```

This will verify:
- ✅ SALT environment variable is set
- ✅ Encrypted keypair can be retrieved from database
- ✅ Decryption works properly
- ✅ All utility functions work correctly

## Usage in Code

### Import the utilities

```typescript
import { getBuyBackKeypair, getBuyBackPublicKey } from './lib/buyback-utils';
```

### Get the full keypair

```typescript
const keypair = await getBuyBackKeypair();
// Use keypair.publicKey and keypair.secretKey as needed
```

### Get just the public key

```typescript
const publicKey = await getBuyBackPublicKey();
console.log(`Public Key: ${publicKey}`);
```

## Utility Functions

### `getBuyBackKeypair()`

Retrieves and decrypts the full Solana keypair from the database.

- **Returns**: `Promise<Keypair>`
- **Throws**: Error if SALT not set, keypair not found, or decryption fails

### `getBuyBackPublicKey()`

Retrieves just the public key as a base58 string.

- **Returns**: `Promise<string>`
- **Throws**: Error if keypair cannot be decrypted

### `verifyBuyBackKeypair()`

Verifies that the keypair can be successfully decrypted.

- **Returns**: `Promise<boolean>`
- **Use**: Testing and validation

## Files

- `src/db/schema/global_params.ts` - Database schema for global_params table
- `src/lib/buyback-utils.ts` - Utility functions for key decryption
- `scripts/insert-buyback-key.ts` - Script to insert encrypted key
- `scripts/verify-buyback-key.ts` - Script to verify encryption setup

## Security Best Practices

1. **Never commit the `SALT`** to version control
2. **Backup your `SALT`** securely (password manager, encrypted vault)
3. **Keep database backups** of the `global_params` table
4. **Rotate the `SALT` periodically** and re-encrypt the key if needed
5. **Use environment-specific SALTs** for dev/staging/production

## Troubleshooting

### Error: "SALT environment variable is required"

**Solution**: Make sure the `SALT` environment variable is set in your `.env` file.

```bash
echo "SALT=your_secret_salt_here" >> .env
```

### Error: "No encrypted buy_back_key_v2 found"

**Solution**: Run the insert script to add the encrypted key to the database:

```bash
bun run scripts/insert-buyback-key.ts
```

### Error: "Decryption failed"

**Solution**: Verify you're using the correct `SALT` value that matches the one used during encryption. If the SALT changed, you'll need to re-encrypt the key with the new SALT.

## Current Setup

- **Public Key**: `J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo`
- **Param Title**: `buy_back_key_v2`
- **Encryption**: AES-256-CBC with SHA-256 key derivation




