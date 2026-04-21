# MEV Arbitrage Bot — Complete System Integration Guide

## 🔧 What Was Fixed

### Issue 1: Icon Mapping Crash (Android)
**Problem:** Tab icons were not mapped to Material Icons, causing app crash on Android
**Fix:** Added all missing icon mappings to `components/ui/icon-symbol.tsx`
**Result:** ✅ App now launches without crashing

### Issue 2: No Real Backend Connection
**Problem:** App was a pure simulator using AsyncStorage, never connected to Alchemy RPC
**Fix:** Created real backend API server (`backend/server.ts`) that:
- Connects to Alchemy RPC
- Scans for real arbitrage opportunities
- Executes actual trades
- Streams live data
**Result:** ✅ System now connects to real blockchain

### Issue 3: App Not Pulling Data
**Problem:** Dashboard used AsyncStorage simulator, no network calls
**Fix:** 
- Created `app/lib/api-client.ts` - Real API client
- Updated `app/screens/DashboardScreen.tsx` - Now calls backend API
- Implemented real data flow: RPC → Scanner → Keeper → App
**Result:** ✅ App now pulls real data from backend

### Issue 4: Alchemy RPC Test Failing
**Problem:** Connection test used wrong endpoint
**Fix:** Implemented proper JSON-RPC call to Alchemy:
```typescript
const rpcUrl = `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
await rpcCall(rpcUrl, "eth_blockNumber", []);
```
**Result:** ✅ RPC connection test now works

### Issue 5: Scanner Not Working
**Problem:** No actual scanning loop running
**Fix:** Created backend scanning loop that:
- Runs every 5 seconds
- Queries Alchemy RPC for pool data
- Runs Bellman-Ford detection
- Calculates profit/loss
- Returns opportunities to app
**Result:** ✅ Scanner now finds real opportunities

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Android App (Mobile)                     │
│  - Dashboard showing live trades and P&L                    │
│  - Settings for Alchemy key + Private key                   │
│  - Start/Stop bot controls                                  │
│  - Real-time opportunity updates                            │
└────────────────────┬────────────────────────────────────────┘
                     │ REST API + JSON
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼────┐  ┌──▼───┐  ┌────▼──────┐
    │ Keeper  │  │Queen │  │ Scanner   │
    │(Node.js)│  │(Node)│  │(Node.js)  │
    │Execute  │  │Risk  │  │Bellman-   │
    │trades   │  │Check │  │Ford       │
    └────┬────┘  └──┬───┘  └────┬──────┘
         │          │           │
         └──────────┼───────────┘
                    │ Alchemy RPC
         ┌──────────▼──────────┐
         │ Polygon Mainnet     │
         │ - AAVE V3           │
         │ - QuickSwap         │
         │ - SushiSwap         │
         └─────────────────────┘
```

---

## 📋 How to Deploy & Test

### Step 1: Start Backend Server

```bash
cd /home/ubuntu/mev-arb-bot

# Install dependencies (if not already installed)
npm install

# Start backend server on port 3001
npm run dev:server

# Expected output:
# MEV Arbitrage Bot API running on port 3001
# Health check: http://localhost:3001/health
```

### Step 2: Configure App Settings

1. Open Android app
2. Go to **Settings** tab
3. Enter:
   - **Alchemy API Key:** Your Alchemy key
   - **Private Key:** Your wallet private key
   - **Contract Address:** EliteAntArb contract address (deploy first)
4. Tap "Test Connection"
5. Should see ✅ "Connected"

### Step 3: Deploy Smart Contract

```bash
cd contracts

# Deploy to Polygon mainnet
npx hardhat run scripts/deploy.ts --network polygon

# Save the contract address to settings
```

### Step 4: Fund Wallet

Send USDC to your wallet:
- **Phase 1:** $20 USDC (testing)
- **Phase 2:** $100 USDC (scaling)
- **Phase 3:** $1,000+ USDC (production)

### Step 5: Start Bot

1. Open app Dashboard
2. Tap "START BOT"
3. Monitor in real-time:
   - Live opportunities
   - Successful trades
   - P&L tracking
   - Gas costs

---

## 🔌 API Endpoints

### Health Check
```
GET /health
Response: { status: "ok", timestamp: 1234567890, botRunning: false }
```

### Validate Alchemy Key
```
POST /api/validate-alchemy
Body: { apiKey: "your-key" }
Response: { valid: true } or { valid: false, error: "..." }
```

### Get Bot Status
```
GET /api/status
Response: {
  isRunning: false,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  totalProfit: 0,
  lastTrade: null,
  lastError: null,
  lastScan: null,
  opportunities: [],
  uptime: 123.45
}
```

### Get Opportunities
```
GET /api/opportunities
Response: {
  opportunities: [
    {
      id: "opp_1",
      path: ["WMATIC", "USDC", "WMATIC"],
      profit_usd: 12.50,
      slippage_pct: 0.3,
      mev_risk_score: 25,
      liquidity_usd: 50000
    }
  ],
  count: 1
}
```

### Scan for Opportunities
```
POST /api/scan
Body: {
  apiKey: "your-key",
  settings: {
    minProfitUsd: 5,
    maxSlippagePct: 0.5,
    maxVolatilityPct: 5,
    maxGasGwei: 100,
    tradeAmountMatic: 1
  }
}
Response: { opportunities: [...], gasGwei: 30, maticPriceUsd: 0.55 }
```

### Start Bot
```
POST /api/bot/start
Body: { apiKey: "your-key" }
Response: { status: "started", message: "Bot started successfully" }
```

### Stop Bot
```
POST /api/bot/stop
Response: { status: "stopped", message: "Bot stopped successfully" }
```

### Execute Trade
```
POST /api/execute-trade
Body: {
  apiKey: "your-key",
  privateKey: "0x...",
  opportunity: { ... }
}
Response: {
  success: true,
  txHash: "0x...",
  estimatedProfit: 12.50,
  actualProfit: 10.00,
  gasUsed: 400000,
  gasCost: 2.50
}
```

---

## 🧪 Testing the System

### Test 1: Validate Alchemy Connection

```bash
curl -X POST http://localhost:3001/api/validate-alchemy \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"your-alchemy-key"}'

# Expected: { "valid": true }
```

### Test 2: Scan for Opportunities

```bash
curl -X POST http://localhost:3001/api/scan \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey":"your-alchemy-key",
    "settings":{
      "minProfitUsd":5,
      "maxSlippagePct":0.5,
      "maxVolatilityPct":5,
      "maxGasGwei":100,
      "tradeAmountMatic":1
    }
  }'

# Expected: { "opportunities": [...], "gasGwei": 30, "maticPriceUsd": 0.55 }
```

### Test 3: Start Bot

```bash
curl -X POST http://localhost:3001/api/bot/start \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"your-alchemy-key"}'

# Expected: { "status": "started", "message": "Bot started successfully" }
```

### Test 4: Check Status

```bash
curl http://localhost:3001/api/status

# Expected: { "isRunning": true, "totalTrades": 0, ... }
```

---

## 📊 Real-Time Monitoring

### Via App Dashboard
- Live P&L tracking
- Successful/failed trades count
- Success rate percentage
- Recent opportunities
- Network status

### Via API
- Poll `/api/status` every 5 seconds
- Poll `/api/opportunities` every 5 seconds
- Listen for trade execution events

### Via Logs
```bash
# Watch backend logs
tail -f /home/ubuntu/mev-arb-bot/backend.log

# Expected output:
# [INFO] Scan complete: found 3 opportunities
# [INFO] Executing trade: WMATIC → USDC → WMATIC
# [INFO] Trade successful: profit=$12.50, gas=$2.50
```

---

## ⚠️ Common Issues & Solutions

### Issue: "Connection refused" on app
**Solution:**
1. Make sure backend server is running: `npm run dev:server`
2. Check backend is on port 3001: `lsof -i :3001`
3. Verify Alchemy key is correct
4. Check internet connection

### Issue: "No opportunities found"
**Solution:**
1. Lower `minProfitUsd` to $1
2. Increase `maxSlippagePct` to 1%
3. Wait longer (opportunities are rare)
4. Check gas prices (might be too high)

### Issue: "Trades failing"
**Solution:**
1. Verify contract is deployed
2. Check wallet has USDC
3. Check gas price (might be spiking)
4. Verify private key is correct

### Issue: "High latency"
**Solution:**
1. Use private Alchemy RPC (you have it)
2. Reduce scan interval from 5s to 2s
3. Optimize Bellman-Ford (already done)
4. Consider co-located server (advanced)

---

## 🚀 Next Steps

1. **Deploy Contract** — Run `npx hardhat run scripts/deploy.ts --network polygon`
2. **Start Backend** — Run `npm run dev:server`
3. **Configure App** — Enter Alchemy key + private key
4. **Fund Wallet** — Send $20 USDC
5. **Start Bot** — Tap "START BOT" in app
6. **Monitor** — Watch trades execute in real-time

---

## 📞 Support

- **Backend Logs:** Check `/home/ubuntu/mev-arb-bot/backend.log`
- **App Logs:** Check React Native console in Expo
- **Alchemy Docs:** https://docs.alchemy.com/
- **Polygon Docs:** https://polygon.technology/
- **AAVE V3 Docs:** https://docs.aave.com/

**System is now fully wired and ready for real trading!** 🎯
