# Buyback Wallet Balance Feature

This document explains the new buyback wallet balance monitoring feature.

## Overview

The system now includes:
- **Backend API** endpoints to retrieve buyback wallet information
- **Frontend Admin Page** to display wallet balance and details
- **Automatic refresh** every 30 seconds
- **Secure decryption** - private key never leaves the backend

## Backend API Endpoints

### 1. Get Full Wallet Info
```
GET /api/buyback-wallet/info
```

Returns:
```json
{
  "success": true,
  "data": {
    "publicKey": "J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo",
    "balance": 276149995,
    "balanceSOL": "0.276149995",
    "timestamp": "2025-12-17T08:30:00.000Z"
  }
}
```

### 2. Get Balance Only
```
GET /api/buyback-wallet/balance
```

Returns:
```json
{
  "success": true,
  "data": {
    "balance": 276149995,
    "balanceSOL": "0.276149995",
    "timestamp": "2025-12-17T08:30:00.000Z"
  }
}
```

### 3. Get Public Key Only
```
GET /api/buyback-wallet/public-key
```

Returns:
```json
{
  "success": true,
  "data": {
    "publicKey": "J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo",
    "timestamp": "2025-12-17T08:30:00.000Z"
  }
}
```

## Frontend Admin Page

Access the wallet balance page at: **`/admin/wallet`**

Features:
- 💰 Large, easy-to-read balance display
- 🔄 Manual and automatic refresh (every 30 seconds)
- 📋 Copy public key to clipboard
- 🔗 Direct link to Solana Explorer
- 📊 Shows balance in both SOL and lamports
- ⏰ Displays last update time

## Setup & Configuration

### Environment Variables

**Backend (.env):**
```bash
SALT=your_encryption_salt
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# Or use Helius RPC for better performance:
# SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

**Frontend (.env):**
```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### Testing

Run the test script to verify everything works:
```bash
cd futurefrog-backend
bun run scripts/test-buyback-wallet-api.ts
```

Expected output:
```
✅ All tests passed!

📋 Summary:
   Public Key: J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo
   Balance: 0.276149995 SOL
   RPC: https://api.mainnet-beta.solana.com
```

## Security

✅ **Private key is NEVER exposed**
- Private key is stored encrypted in the database
- Only the backend can decrypt the key using the SALT
- Frontend only receives public information (balance, public key)
- All decryption happens server-side

✅ **Read-only operations**
- These endpoints only READ the balance
- No transactions can be initiated from the frontend
- Keypair is only used to check balance

## Files Created/Modified

### Backend
- ✅ `src/routes/buyback-wallet.ts` - API endpoints
- ✅ `src/index.ts` - Added route registration
- ✅ `scripts/test-buyback-wallet-api.ts` - Test script
- ✅ `.env` - Added SOLANA_RPC_URL

### Frontend
- ✅ `app/admin/wallet/page.tsx` - Wallet balance page
- ✅ `app/admin/page.tsx` - Added wallet link

## Current Wallet Info

- **Public Key**: `J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo`
- **Current Balance**: ~0.276 SOL
- **Explorer**: https://explorer.solana.com/address/J8yaYVhBtTQ6zfNv92iYumYhGsgi5euBAWUz7L3qXFeo

## Troubleshooting

### Backend server not restarting with new .env
**Issue**: Environment variables not updating

**Solution**: Manually restart the backend:
```bash
cd futurefrog-backend
# Stop the current server (Ctrl+C)
bun run dev
```

### API returns "Failed to connect to backend"
**Issue**: Backend server not running or wrong port

**Solution**: 
1. Check backend is running: `curl http://localhost:8000/`
2. Verify PORT in backend .env is 8000
3. Check CORS is enabled in backend

### Invalid API key error with Helius
**Issue**: Helius RPC URL format incorrect

**Solution**: Use public RPC or correct Helius format:
```bash
# Public (slower but works)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Helius (faster, requires valid API key)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
```

## Future Enhancements

Potential improvements:
- [ ] Show transaction history
- [ ] Display wallet age and first transaction
- [ ] Add price conversion (SOL → USD)
- [ ] Show other token balances (SPL tokens)
- [ ] Alert notifications when balance is low
- [ ] Historical balance chart

## Usage

1. Navigate to `/admin/wallet` in your browser
2. View current wallet balance
3. Click copy button to copy public key
4. Click Solana Explorer link to see full details
5. Balance auto-refreshes every 30 seconds
6. Click refresh button for manual update







