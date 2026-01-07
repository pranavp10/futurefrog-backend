# Kalshi Markets Backend

A lightweight API server that proxies Kalshi prediction market data via the DFlow API.

## Features

- Crypto prediction markets (BTC, ETH, SOL)
- Real-time market quotes for trading
- User position tracking
- Order book data
- Trade history

## Setup

1. Install dependencies:
```bash
bun install
```

2. Set environment variables:
```bash
export DFLOW_API_KEY=your_dflow_api_key
export SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
```

3. Run the development server:
```bash
bun run dev
```

## API Endpoints

All endpoints are prefixed with `/api/kalshi`

| Endpoint | Description |
|----------|-------------|
| `GET /crypto` | Get all crypto prediction markets |
| `GET /events` | Get all events with nested markets |
| `GET /market/:ticker` | Get market by ticker |
| `GET /quote` | Get trading quote for a market |
| `GET /positions/:publicKey` | Get user's positions |
| `GET /orderbook/:ticker` | Get orderbook for a market |
| `GET /trades` | Get trade history |
| `GET /redeem` | Request redemption for winning positions |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DFLOW_API_KEY` | DFlow API key for market data | Yes |
| `SOLANA_RPC_ENDPOINT` | Solana RPC endpoint | No (defaults to mainnet) |
| `PORT` | Server port | No (defaults to 3000) |

