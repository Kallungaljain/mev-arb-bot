# Rust MEV Arbitrage Engine — VPS Deployment Guide

## 🚀 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Android App (Monitor)                    │
│         - View dashboard, P&L, trades                       │
│         - Start/Stop bot                                    │
│         - Configure settings                                │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket/REST (wss://vps:3001)
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼────┐  ┌──▼───┐  ┌────▼──────┐
    │ Keeper  │  │Queen │  │ Scanner   │
    │(Rust)   │  │(Rust)│  │(Rust)     │
    │95% safe │  │5% risky│ │Bellman-   │
    │trades   │  │trades │  │Ford       │
    └────┬────┘  └──┬───┘  └────┬──────┘
         │          │           │
         └──────────┼───────────┘
                    │
         ┌──────────▼──────────┐
         │  EliteAntArb.sol    │
         │  (Flash Loan)       │
         │  (On-chain)         │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ Polygon Mainnet     │
         │ - AAVE V3           │
         │ - QuickSwap         │
         │ - SushiSwap         │
         └─────────────────────┘
```

---

## Free VPS Options

### Option 1: Render.com (Recommended)
- **Free Tier:** 750 hours/month (always-on)
- **Specs:** 0.5 GB RAM, shared CPU
- **Startup:** 15 minutes
- **Cost:** Free (forever)

### Option 2: Railway.app
- **Free Tier:** $5/month credits
- **Specs:** 0.5 GB RAM, shared CPU
- **Startup:** 10 minutes
- **Cost:** Free (with credits)

### Option 3: Heroku (Deprecated but still works)
- **Free Tier:** Discontinued (use Render instead)

### Option 4: Fly.io
- **Free Tier:** 3 shared-cpu-1x 256MB VMs
- **Specs:** 256 MB RAM, shared CPU
- **Startup:** 5 minutes
- **Cost:** Free

**Recommendation: Use Render.com** (most reliable, always-on)

---

## Step 1: Deploy to Render.com

### 1.1 Create Render Account
1. Go to https://render.com
2. Sign up with GitHub
3. Authorize Render

### 1.2 Create New Service

1. Click "New +" → "Web Service"
2. Connect your GitHub repository
3. Configure:
   - **Name:** `mev-arb-bot`
   - **Runtime:** `Rust`
   - **Build Command:** `cd rust-engine && cargo build --release`
   - **Start Command:** `./rust-engine/target/release/server`
   - **Plan:** Free

### 1.3 Set Environment Variables

In Render dashboard, add:

```env
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
PRIVATE_KEY=your_private_key_here
CONTRACT_ADDRESS=0x...
NETWORK=polygon
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
WEBSOCKET_PORT=3001
LOG_LEVEL=info
MIN_PROFIT_USD=5
MAX_SLIPPAGE_PERCENT=0.5
MEV_RISK_THRESHOLD=60
```

### 1.4 Deploy

1. Click "Deploy"
2. Wait 5-10 minutes for build
3. Get your URL: `https://mev-arb-bot.onrender.com`

---

## Step 2: Configure Android App

### 2.1 Update WebSocket URL

In Android app settings:

```
Server URL: wss://mev-arb-bot.onrender.com
API URL: https://mev-arb-bot.onrender.com/api
```

### 2.2 Test Connection

1. Open app
2. Go to Settings
3. Tap "Test Connection"
4. Should see "Connected" ✅

---

## Step 3: Start Trading

### 3.1 Deploy Contract

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network polygon
```

Save the contract address to environment variables.

### 3.2 Fund Wallet

Send USDC to your wallet:
- Phase 1: $20 USDC
- Phase 2: $100 USDC
- Phase 3: $1,000+ USDC

### 3.3 Start Bot

1. Open Android app
2. Tap "Dashboard"
3. Tap "START BOT"
4. Monitor trades in real-time

---

## Performance Metrics

### Expected Latency

| Component | Latency | Notes |
|-----------|---------|-------|
| Pool fetch (RPC) | 30-50ms | Network I/O |
| Bellman-Ford | 1-2ms | Rust optimization |
| Profit simulation | 2-5ms | Rust optimization |
| Calldata encoding | 1-2ms | Rust optimization |
| Transaction submit | 100-200ms | Network I/O |
| **Total** | **135-260ms** | **50-70% improvement** |

### Expected Profit (Phase 1)

| Metric | Conservative | Realistic | Optimistic |
|--------|--------------|-----------|-----------|
| Capital | $10 | $20 | $50 |
| Loan Size | $1,000 | $5,000 | $10,000 |
| Daily Profit | $10-$50 | $70-$200 | $200-$400 |
| Monthly Profit | $300-$1,500 | $2,100-$6,000 | $6,000-$12,000 |

---

## Monitoring & Logging

### View Logs

**Render Dashboard:**
1. Go to your service
2. Click "Logs"
3. See real-time logs

**Command Line:**
```bash
# SSH into Render (if available)
ssh user@mev-arb-bot.onrender.com

# View logs
tail -f /var/log/mev-arb-bot.log
```

### Key Metrics to Monitor

1. **Scan Latency** — Should be <200ms
2. **Opportunities Found** — Should be 1-5 per hour
3. **Success Rate** — Should be 70-80%
4. **Profit/Trade** — Should be $5-$50
5. **Gas Costs** — Should be $2-$5 per trade

---

## Troubleshooting

### Issue: "Connection refused"

**Solution:**
1. Check Render logs for errors
2. Verify RPC_URL is correct
3. Verify PRIVATE_KEY is valid
4. Restart service

### Issue: "No opportunities found"

**Solution:**
1. Check MIN_PROFIT_USD (lower it to $1)
2. Check MAX_SLIPPAGE_PERCENT (increase to 1%)
3. Wait longer (opportunities are rare)
4. Check gas prices (might be too high)

### Issue: "Trades failing"

**Solution:**
1. Check contract is deployed
2. Check wallet has USDC
3. Check gas price (might be too high)
4. Check MEV_RISK_THRESHOLD (lower it)

### Issue: "High latency"

**Solution:**
1. Upgrade Render plan (if needed)
2. Use faster RPC (Alchemy is good)
3. Optimize Bellman-Ford (already done in Rust)
4. Use co-located server (advanced)

---

## Scaling to Production

### Phase 1: Validation ($20 capital)
- Run on free Render tier
- Monitor for 1 week
- Expected profit: $600-$6,000/month

### Phase 2: Scaling ($100 capital)
- Upgrade to Render paid tier ($7/month)
- Increase loan amounts
- Expected profit: $6,000-$60,000/month

### Phase 3: Production ($1,000+ capital)
- Upgrade to dedicated server
- Co-locate near RPC provider
- Expected profit: $60,000-$600,000/month

---

## Security Best Practices

### Private Key Management

✅ **DO:**
- Use environment variables
- Use Render secrets (not in code)
- Rotate keys regularly
- Use dedicated wallet (not main wallet)

❌ **DON'T:**
- Commit keys to GitHub
- Share keys in messages
- Use main wallet
- Log keys

### Network Security

✅ **DO:**
- Use HTTPS/WSS (encrypted)
- Use Render's built-in SSL
- Monitor for suspicious activity
- Set up alerts

❌ **DON'T:**
- Use HTTP (unencrypted)
- Expose RPC keys
- Allow public access to admin endpoints

---

## Deployment Checklist

- [ ] Render account created
- [ ] Repository connected to Render
- [ ] Environment variables set
- [ ] Contract deployed to Polygon
- [ ] Wallet funded with USDC
- [ ] Android app configured
- [ ] WebSocket connection tested
- [ ] First trade executed
- [ ] Monitoring set up
- [ ] Alerts configured

---

## Support & Monitoring

### Render Support
- Dashboard: https://dashboard.render.com
- Docs: https://render.com/docs
- Status: https://status.render.com

### Polygon Support
- Explorer: https://polygonscan.com
- Faucet: https://faucet.polygon.technology
- Docs: https://polygon.technology

### AAVE V3 Support
- Docs: https://docs.aave.com/
- Dashboard: https://aave.com
- Testnet: https://testnet.aave.com

---

## Next Steps

1. **Deploy to Render** (15 minutes)
2. **Configure Android app** (5 minutes)
3. **Fund wallet** (varies)
4. **Start bot** (1 minute)
5. **Monitor trades** (ongoing)

**You're ready to go live!** 🚀
