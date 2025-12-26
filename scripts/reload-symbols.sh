#!/bin/bash

# Reload symbol mappings from CoinGecko
# Run this script when you want to refresh the coin symbols in Redis

echo "🔄 Reloading symbol mappings..."
curl -X POST http://localhost:8000/admin/reload-symbol-mappings | jq '.'
echo ""
echo "✅ Done! Symbol mappings have been refreshed."

