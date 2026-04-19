# Production Deployment Guide — Elite MEV Arbitrage Engine

## Overview

This guide walks you through deploying the real production system:
- **Rust Scanner** — WebSocket subscriptions to Polygon pools
- **Node.js Keeper** — Real trade execution via smart contract
- **Smart Contract** — Deployed on Polygon mainnet
- **Android App** — Connected to keeper API

## Prerequisites

- **VPS** — Ubuntu 22.04 LTS (Oracle Cloud, AWS, Linode, etc.)
- **Alchemy API Key** — Free tier from https://www.alchemy.com
- **Polygon Account** — With MATIC for gas (testnet: Mumbai)
- **Private Key** — For signing transactions
- **Rust** — Installed on VPS
- **Node.js** — v18+ installed on VPS

## Step 1: Setup VPS

```bash
# SSH into your VPS
ssh ubuntu@your-vps-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y build-essential curl git libzmq3-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
rustc --version
node --version
npm --version
```

## Step 2: Clone and Setup Project

```bash
# Clone the project
cd /opt
git clone https://github.com/your-repo/mev-arb-bot.git
cd mev-arb-bot

# Create production environment file
cp .env.production .env
nano .env  # Edit with your credentials
```

## Step 3: Deploy Smart Contract

```bash
cd contracts

# Install dependencies
npm install

# Compile
npx hardhat compile

# Deploy to Polygon Mumbai testnet (first)
npx hardhat run scripts/deploy.ts --network mumbai

# Note the deployed address and update .env
# ELITE_ANT_ADDRESS=0x...

# Test with real flash loan
npx hardhat test --network mumbai
```

## Step 4: Build and Run Rust Scanner

```bash
cd scanner-prod

# Build (this takes 5-10 minutes)
cargo build --release

# Run
./target/release/scanner

# Verify it's working
# In another terminal:
curl http://localhost:8080/status
```

Expected output:
```json
{
  "connected": true,
  "pools_subscribed": 4,
  "opportunities_detected": 42,
  "last_sync_event": "2026-04-19T12:34:56Z",
  "recent_opportunities": [...]
}
```

## Step 5: Run Node.js Keeper

```bash
cd keeper-prod

# Install dependencies
npm install

# Start keeper
npm start

# Verify it's running
# In another terminal:
curl http://localhost:3000/status
```

Expected output:
```json
{
  "connected": true,
  "opportunities_received": 42,
  "trades_executed": 3,
  "signer_address": "0x..."
}
```

## Step 6: Connect Android App

1. **Get your VPS IP**:
   ```bash
   curl http://ifconfig.me
   ```

2. **In Android app Settings**:
   - Keeper URL: `http://your-vps-ip:3000`
   - Alchemy API Key: Your key from step 1
   - Private Key: Your Polygon account private key
   - Min Profit: $5 (testnet)
   - Max Slippage: 0.5%

3. **Tap "Test Connection"** — should show "Connected ✓"

## Step 7: Execute Test Trade

1. **Go to Dashboard**
2. **Tap START BOT**
3. **Wait for opportunities** (should appear in ~30 seconds)
4. **Tap an opportunity** with high confidence (>0.8)
5. **Tap EXECUTE**
6. **Monitor on PolygonScan**:
   - Go to https://mumbai.polygonscan.com/
   - Search for your tx hash
   - Verify profit in wallet

## Monitoring

### Check Scanner Status
```bash
curl http://localhost:8080/status | jq
```

### Check Keeper Status
```bash
curl http://localhost:3000/status | jq
```

### View Recent Trades
```bash
curl http://localhost:3000/trades | jq
```

### Monitor Logs
```bash
# Scanner logs
journalctl -u elite-scanner -f

# Keeper logs
journalctl -u elite-keeper -f
```

## Systemd Services (Optional)

Create `/etc/systemd/system/elite-scanner.service`:
```ini
[Unit]
Description=Elite MEV Scanner
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mev-arb-bot/scanner-prod
ExecStart=/home/ubuntu/.cargo/bin/cargo run --release
Restart=always
RestartSec=10
Environment="ALCHEMY_KEY=your_key"

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

### Scanner not connecting to Alchemy
```bash
# Check Alchemy key
echo $ALCHEMY_KEY

# Test WebSocket connection
wscat -c wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### Keeper not receiving opportunities
```bash
# Check ZMQ socket
netstat -an | grep 5555

# Verify scanner is running
curl http://localhost:8080/status
```

### Transactions failing on-chain
```bash
# Check account balance
curl -X POST http://localhost:3000/status | jq .signer_address

# Verify contract address
echo $ELITE_ANT_ADDRESS

# Check gas price
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}' \
  https://polygon-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY
```

## Performance Tuning

### Increase Scanner Throughput
- Add more DEX pairs in `scanner-prod/src/main.rs`
- Use dedicated Alchemy node (paid tier)

### Reduce Keeper Latency
- Run keeper on same machine as scanner
- Use Flashbots Relay for private mempool
- Increase gas price to prioritize execution

### Monitor Metrics
```bash
# Prometheus metrics (if enabled)
curl http://localhost:9090/metrics
```

## Security Best Practices

1. **Never commit `.env` file** to version control
2. **Use environment variables** for all secrets
3. **Rotate private keys** regularly
4. **Use VPS firewall** to restrict access
5. **Enable 2FA** on Alchemy account
6. **Monitor account activity** for unauthorized access
7. **Use testnet first** before mainnet

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

**Last Updated**: 2026-04-19  
**Status**: Production Ready
