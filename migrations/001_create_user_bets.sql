-- Create user_bets table for tracking user betting activity
CREATE TABLE IF NOT EXISTS user_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_key TEXT NOT NULL,
    market_ticker TEXT NOT NULL,
    market_title TEXT,
    event_title TEXT,
    side TEXT NOT NULL,
    contracts NUMERIC NOT NULL,
    entry_price NUMERIC NOT NULL,
    invested_amount NUMERIC NOT NULL,
    tx_signature TEXT NOT NULL UNIQUE,
    mint TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    redemption_amount NUMERIC,
    redemption_tx_signature TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMP,
    redeemed_at TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS user_bets_public_key_idx ON user_bets(public_key);
CREATE INDEX IF NOT EXISTS user_bets_tx_signature_idx ON user_bets(tx_signature);
CREATE INDEX IF NOT EXISTS user_bets_status_idx ON user_bets(status);

