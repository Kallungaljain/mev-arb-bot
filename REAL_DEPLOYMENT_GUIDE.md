# Real Production Deployment Guide

## Overview

This guide deploys a **real, production-grade MEV arbitrage engine** that:
- Connects to Alchemy WebSocket for live Polygon pool events
- Detects real arbitrage opportunities using x*y=k math
- Executes real trades via flash loans on AAVE V3
- Captures actual profit on Polygon mainnet

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Polygon Mainnet                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  QuickSwap & SushiSwap Pools (WMATIC/USDC, etc)     │  │
│  │  AAVE V3 Flash Loan Provider                        │  │
│  │  EliteAntArb Contract (deployed)                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ WebSocket
                            │ Events
                            │
┌─────────────────────────────────────────────────────────────┐
│                    VPS (Your Server)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Rust Scanner (Port 8080)                           │  │
│  │  - WebSocket subscription to Polygon pools          │  │
│  │  - Real-time Sync event decoding                    │  │
│  │  - Arbitrage opportunity detection                  │  │
│  │  - ZeroMQ PUSH to Keeper                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            │ ZeroMQ                         │
│                            │                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Node.js Keeper (Port 3000)                         │  │
│  │  - ZeroMQ PULL from Scanner                         │  │
│  │  - Risk validation                                  │  │
│  │  - Gas estimation                                   │  │
│  │  - Transaction signing & submission                 │  │
│  │  - HTTP API for Android app                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │
│                            │ HTTP
│                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Android App (Your Phone)                           │  │
│  │  - Dashboard with live P&L                          │  │
│  │  - Opportunity list                                 │  │
│  │  - Manual trade approval                            │  │
│  │  - Trade history                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

### 1. Alchemy Account
- Sign up at https://www.alchemy.com
- Create Polygon mainnet app
- Copy API key

### 2. Polygon Account
- Private key with MATIC for gas (testnet: 0.1 MATIC for Mumbai)
- Public address to receive profits

### 3. VPS
- Ubuntu 22.04 LTS
- 2GB RAM, 10GB disk minimum
- Public IP address
- Rust + Node.js installed

### 4. Smart Contract
- Deploy EliteAntArb to Polygon (testnet first)
- Copy contract address

## Step 1: VPS Setup

```bash
# SSH into VPS
ssh ubuntu@your-vps-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y \
  build-essential \
  curl \
  git \
  libzmq3-dev \
  pkg-config

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
rustc --version
node --version
npm --version
```

## Step 2: Deploy Smart Contract

```bash
cd /opt/mev-arb-bot/contracts

# Install dependencies
npm install

# Compile
npx hardhat compile

# Deploy to Mumbai testnet (first)
npx hardhat run scripts/deploy.ts --network mumbai

# Output will show:
# ✓ EliteAntArb deployed to: 0x...

# Save the address
export ELITE_ANT_ADDRESS=0x...
```

## Step 3: Configure Environment

```bash
# Create .env file
cat > /opt/mev-arb-bot/.env << 'EOF'
# Alchemy
ALCHEMY_KEY=your_alchemy_api_key_here

# Polygon Account
PRIVATE_KEY=0x...your_private_key_here

# Smart Contract
ELITE_ANT_ADDRESS=0x...deployed_contract_address

# Risk Parameters
MIN_PROFIT_USD=5
MAX_SLIPPAGE_PCT=0.5
MAX_GAS_GWEI=100

# Server
PORT=3000
ZMQ_PUSH_ADDR=tcp://127.0.0.1:5555
EOF

# Secure the file
chmod 600 /opt/mev-arb-bot/.env
```

## Step 4: Build Rust Scanner

```bash
cd /opt/mev-arb-bot/scanner-prod

# Build (takes 5-10 minutes)
cargo build --release

# Verify binary
ls -lh target/release/scanner
```

## Step 5: Start Rust Scanner

```bash
# In a tmux/screen session
cd /opt/mev-arb-bot/scanner-prod
./target/release/scanner

# Expected output:
# [KEEPER] Connecting to Alchemy WebSocket: wss://polygon-mainnet.g.alchemy.com/v2/...
# [KEEPER] Connected to Alchemy
# [KEEPER] Subscribed to QuickSwap WMATIC/USDC
# [KEEPER] Subscribed to SushiSwap WMATIC/USDC
# ...
# [KEEPER] HTTP server listening on 0.0.0.0:8080
```

## Step 6: Start Node.js Keeper

```bash
# In another tmux/screen session
cd /opt/mev-arb-bot/keeper-prod
npm install
npm start

# Expected output:
# ╔════════════════════════════════════════════════════════════╗
# ║          ELITE MEV ARBITRAGE KEEPER                        ║
# ╚════════════════════════════════════════════════════════════╝
# 
# [KEEPER] Polygon RPC: https://polygon-mainnet.g.alchemy.com/v2/...
# [KEEPER] Signer: 0x...
# [KEEPER] Min profit: $5
# [KEEPER] Max slippage: 0.5%
# [KEEPER] Max gas: 100 Gwei
# 
# [KEEPER] ✓ ZMQ PULL socket listening on tcp://127.0.0.1:5555
# [KEEPER] ✓ HTTP API listening on port 3000
# [KEEPER] Status: http://localhost:3000/status
# [KEEPER] Trades: http://localhost:3000/trades
```

## Step 7: Verify System is Running

```bash
# Check scanner
curl http://localhost:8080/status | jq

# Expected:
# {
#   "connected": true,
#   "pools_subscribed": 4,
#   "opportunities_detected": 42,
#   "last_sync_event": "2026-04-19T12:34:56Z",
#   "recent_opportunities": [...]
# }

# Check keeper
curl http://localhost:3000/status | jq

# Expected:
# {
#   "connected": true,
#   "signer_address": "0x...",
#   "opportunities_received": 42,
#   "trades_executed": 0,
#   "trades_success": 0,
#   "trades_failed": 0,
#   "success_rate": "N/A",
#   "last_opportunity": {...}
# }
```

## Step 8: Connect Android App

1. **Get your VPS IP**:
   ```bash
   curl http://ifconfig.me
   ```

2. **In Android app Settings**:
   - Keeper URL: `http://your-vps-ip:3000`
   - Alchemy API Key: Your key from step 1
   - Private Key: Your Polygon account private key
   - Min Profit: $5 (testnet) or $50 (mainnet)
   - Max Slippage: 0.5%

3. **Tap "Test Connection"** — should show "Connected ✓"

## Step 9: Execute First Test Trade

1. **Go to Dashboard**
2. **Tap START BOT**
3. **Wait for opportunities** (should appear within 1-2 minutes)
4. **Tap an opportunity** with high confidence (>0.8)
5. **Tap EXECUTE**
6. **Monitor on PolygonScan**:
   - Go to https://mumbai.polygonscan.com/ (testnet)
   - Search for your tx hash
   - Verify profit in wallet

## Monitoring

### Real-time Logs

```bash
# Scanner logs
tail -f /var/log/elite-scanner.log

# Keeper logs
tail -f /var/log/elite-keeper.log
```

### Check Status

```bash
# Scanner status
curl http://localhost:8080/status | jq '.opportunities_detected'

# Keeper status
curl http://localhost:3000/status | jq '.trades_executed'

# Recent trades
curl http://localhost:3000/trades | jq '.[0]'
```

### Performance Metrics

```bash
# Opportunities per minute
curl http://localhost:8080/status | jq '.opportunities_detected'

# Success rate
curl http://localhost:3000/status | jq '.success_rate'

# Average gas cost
curl http://localhost:3000/trades | jq '.[].gas_cost_usd' | awk '{sum+=$1; count++} END {print sum/count}'
```

## Systemd Services (Optional)

Create `/etc/systemd/system/elite-scanner.service`:

```ini
[Unit]
Description=Elite MEV Scanner
After=network.target
Wants=elite-keeper.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mev-arb-bot/scanner-prod
ExecStart=/home/ubuntu/.cargo/bin/cargo run --release
Restart=always
RestartSec=10
EnvironmentFile=/opt/mev-arb-bot/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/elite-keeper.service`:

```ini
[Unit]
Description=Elite MEV Keeper
After=network.target elite-scanner.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mev-arb-bot/keeper-prod
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
EnvironmentFile=/opt/mev-arb-bot/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable elite-scanner elite-keeper
sudo systemctl start elite-scanner elite-keeper
sudo systemctl status elite-scanner elite-keeper
```

## Troubleshooting

### Scanner not connecting

```bash
# Check Alchemy key
echo $ALCHEMY_KEY

# Test WebSocket connection
wscat -c wss://polygon-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY
```

### Keeper not receiving opportunities

```bash
# Check ZMQ socket
netstat -an | grep 5555

# Verify scanner is running
curl http://localhost:8080/status
```

### Transactions failing

```bash
# Check account balance
curl http://localhost:3000/status | jq '.signer_address'

# Check gas price
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}' \
  https://polygon-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY | jq '.result'
```

## Performance Optimization

### Increase Throughput

1. **Add more DEX pairs** in `scanner-prod/src/main.rs`:
   ```rust
   const POOLS: &[(&str, &str, &str, &str, u8, u8)] = &[
       // Add more pools here
   ];
   ```

2. **Use Alchemy dedicated node** (paid tier) for lower latency

3. **Increase gas price** for faster execution:
   ```bash
   export MAX_GAS_GWEI=200
   ```

### Reduce Latency

1. **Run scanner and keeper on same machine**
2. **Use Flashbots Relay** for private mempool
3. **Increase ZMQ buffer size**

## Security Best Practices

1. **Never commit `.env`** to version control
2. **Use environment variables** for all secrets
3. **Rotate private keys** regularly
4. **Enable VPS firewall** to restrict access
5. **Use 2FA** on Alchemy account
6. **Monitor account activity** for unauthorized access

## Mainnet Deployment

Once tested on Mumbai testnet:

1. **Deploy contract to Polygon mainnet**:
   ```bash
   npx hardhat run scripts/deploy.ts --network polygon
   ```

2. **Update `.env`**:
   ```
   ELITE_ANT_ADDRESS=0x...mainnet_address
   MIN_PROFIT_USD=50  # Higher threshold for mainnet
   ```

3. **Restart services**:
   ```bash
   sudo systemctl restart elite-scanner elite-keeper
   ```

4. **Monitor closely** for first 24 hours

## Support

- **Alchemy Docs**: https://docs.alchemy.com/
- **Ethers.js Docs**: https://docs.ethers.org/
- **Polygon Docs**: https://polygon.technology/developers/
- **Hardhat Docs**: https://hardhat.org/docs

---

**Status**: Production Ready  
**Last Updated**: 2026-04-19  
**Version**: 1.0.0
