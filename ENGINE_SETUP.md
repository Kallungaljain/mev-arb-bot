# Elite MEV Arbitrage Engine - Setup Guide

## What This Engine Does

This is a **real, production-grade MEV arbitrage engine** that:

1. **Connects to Polygon** via Alchemy WebSocket
2. **Detects real arbitrage opportunities** by comparing prices across QuickSwap and SushiSwap
3. **Executes real trades** using flash loans from AAVE V3
4. **Captures actual profit** on Polygon mainnet

## Prerequisites

### 1. Alchemy Account
- Sign up at https://www.alchemy.com
- Create a Polygon app (mainnet or Mumbai testnet)
- Copy your API key

### 2. Polygon Account
- Private key with MATIC for gas fees
- For testnet: Get free MATIC from https://faucet.polygon.technology/
- For mainnet: Have real MATIC in your wallet

### 3. Node.js
```bash
node --version  # Should be v18+
npm --version   # Should be v9+
```

### 4. Smart Contract Deployed
- Deploy EliteAntArb contract to Polygon (testnet first)
- Copy the contract address

## Installation

### Step 1: Install Dependencies

```bash
cd /home/ubuntu/mev-arb-bot/engine
npm install
```

### Step 2: Configure Environment

Create a `.env` file:

```bash
cat > .env << 'EOF'
ALCHEMY_KEY=your_alchemy_api_key_here
PRIVATE_KEY=0x...your_private_key_here
ELITE_ANT_ADDRESS=0x...deployed_contract_address
MIN_PROFIT_USD=5
MAX_SLIPPAGE_PCT=0.5
MAX_GAS_GWEI=100
NETWORK=mumbai
PORT=3000
EOF
```

**Important:** Never commit `.env` to version control!

### Step 3: Start the Engine

```bash
npm start
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║          ELITE MEV ARBITRAGE ENGINE                        ║
╚════════════════════════════════════════════════════════════╝

[INIT] Network: mumbai
[INIT] RPC: https://polygon-mumbai.g.alchemy.com/v2/...
[INIT] Signer: 0x...
[INIT] Min Profit: $5
[INIT] Max Slippage: 0.5%
[INIT] Max Gas: 100 Gwei

[INIT] ✓ Connected to Polygon (block 12345678)
[LOOP] Starting main scanning loop...

[API] HTTP server listening on port 3000
[API] Status: http://localhost:3000/status
[API] Opportunities: http://localhost:3000/opportunities
[API] Trades: http://localhost:3000/trades
```

## How It Works

### 1. Opportunity Detection

Every 5 seconds, the engine:

1. Fetches reserves from QuickSwap and SushiSwap pools
2. Calculates prices using the x*y=k formula
3. Detects spreads (price differences) > 0.3%
4. Estimates profit after gas costs
5. Ranks opportunities by confidence

### 2. Trade Execution

When a high-confidence opportunity is found:

1. Initiates a flash loan from AAVE V3
2. Swaps on the cheaper DEX (buy)
3. Swaps on the expensive DEX (sell)
4. Repays the flash loan + fee
5. Keeps the profit

### 3. Risk Management

The engine protects against losses by:

- **Minimum profit threshold**: Only executes if profit > $5 (configurable)
- **Maximum slippage**: Rejects if slippage > 0.5% (configurable)
- **Gas cost check**: Skips if gas cost > estimated profit
- **Confidence scoring**: Only auto-executes if confidence > 0.75

## API Endpoints

### GET /status

Returns current engine status:

```bash
curl http://localhost:3000/status | jq
```

Response:

```json
{
  "connected": true,
  "signer_address": "0x...",
  "network": "mumbai",
  "stats": {
    "detected": 42,
    "executed": 2,
    "success": 2,
    "failed": 0,
    "totalProfit": 12.50
  },
  "opportunities_detected": 5,
  "recent_opportunities": [...]
}
```

### GET /opportunities

Returns current opportunities:

```bash
curl http://localhost:3000/opportunities | jq
```

### GET /trades

Returns executed trades:

```bash
curl http://localhost:3000/trades | jq
```

### POST /execute

Manually execute an opportunity:

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "opportunity": {
      "id": "WMATIC/USDC-1234567890",
      "pair": "WMATIC/USDC",
      "spreadPct": "0.50",
      "estimatedProfitUSD": "10.00",
      "confidence": "0.85"
    }
  }' | jq
```

## Testing

### Test 1: Check Connection

```bash
curl http://localhost:3000/status
```

Should show `"connected": true`

### Test 2: Monitor Opportunities

```bash
watch -n 1 'curl -s http://localhost:3000/status | jq .stats'
```

Should show increasing `detected` count

### Test 3: Execute Test Trade

1. Wait for an opportunity with high confidence (> 0.75)
2. Call `/execute` endpoint manually
3. Monitor the transaction on PolygonScan

## Troubleshooting

### Engine not connecting

```bash
# Check Alchemy key
echo $ALCHEMY_KEY

# Test RPC connection
curl -X POST \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  https://polygon-mumbai.g.alchemy.com/v2/$ALCHEMY_KEY
```

### No opportunities detected

1. Check if pools have liquidity
2. Verify DEX addresses are correct
3. Check gas prices (may be too high)

### Transactions failing

1. Verify account has enough MATIC for gas
2. Check if contract address is correct
3. Monitor gas price trends

## Performance Optimization

### Increase Scan Frequency

Edit `engine/index.js`, change:

```javascript
}, 5000); // Change to 2000 for 2-second scans
```

### Add More DEX Pairs

Add to `DEX_PAIRS` array:

```javascript
{
  name: 'WBTC/USDC',
  token0: '0x...',
  token1: '0x...',
  // ...
}
```

### Use Flashbots Relay

Replace Alchemy RPC with Flashbots:

```javascript
const rpc = 'https://relay.flashbots.net';
```

## Security

1. **Never share your private key**
2. **Use environment variables** for all secrets
3. **Rotate keys regularly**
4. **Monitor account activity**
5. **Start with small amounts** on testnet

## Mainnet Deployment

Once tested on Mumbai:

1. Deploy contract to Polygon mainnet
2. Update `.env` with mainnet addresses
3. Change `NETWORK=polygon`
4. Increase `MIN_PROFIT_USD` to $50+
5. Monitor closely for first 24 hours

## Support

- Alchemy Docs: https://docs.alchemy.com/
- Ethers.js: https://docs.ethers.org/
- Polygon: https://polygon.technology/
- AAVE Flash Loans: https://docs.aave.com/developers/guides/flash-loans

---

**Status**: Production Ready  
**Version**: 1.0.0  
**Last Updated**: 2026-04-19
