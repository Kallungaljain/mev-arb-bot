# VPS Deployment Guide — Elite MEV Arbitrage Bot

Complete step-by-step guide to deploy the arbitrage engine on a production VPS.

---

## Prerequisites

- **VPS:** Ubuntu 22.04 LTS or later (2GB RAM minimum, 20GB disk)
- **Alchemy API Key:** Get from [alchemy.com](https://alchemy.com) (free tier works)
- **Private Key:** Polygon wallet with ~0.5 MATIC for gas
- **Profit Wallet:** MetaMask address to receive arbitrage profits

---

## Step 1: Provision VPS

### Option A: Oracle Cloud (Free Tier)

```bash
# Create Ubuntu 22.04 instance
# - Compute Shape: Ampere (ARM) — free tier eligible
# - Memory: 6GB
# - Storage: 100GB
# - Network: Allow ports 22, 3000, 8080, 5000

# SSH into the instance
ssh ubuntu@<instance-ip>
```

### Option B: Linode, DigitalOcean, or AWS

```bash
# Create Ubuntu 22.04 instance with 2GB RAM minimum
# Open ports: 22 (SSH), 3000 (API), 8080 (Metrics), 5000 (Queen)
```

---

## Step 2: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install Rust (for scanner)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

# Install Git and build tools
sudo apt install -y git build-essential pkg-config libssl-dev

# Install pnpm
sudo npm install -g pnpm

# Verify installations
node --version   # v22.x.x
pnpm --version   # 9.x.x
rustc --version  # 1.7x.x
```

---

## Step 3: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/yourusername/mev-arb-bot.git
cd mev-arb-bot

# Install dependencies
pnpm install

# Build Rust scanner
cd scanner-rust
cargo build --release
cd ..

# Verify build
ls -lah scanner-rust/target/release/elite-scanner
```

---

## Step 4: Configure Environment

Create `.env` file in project root:

```bash
cat > .env << 'EOF'
# ─── Alchemy (Polygon Mainnet) ─────────────────────────────────────────────
ALCHEMY_API_KEY=your_alchemy_api_key_here

# ─── Private Key (Polygon Wallet) ──────────────────────────────────────────
# WARNING: Never commit this to git!
# Use a dedicated bot wallet with minimal funds (~0.5 MATIC)
PRIVATE_KEY=0x...your_private_key_hex_here...

# ─── Profit Wallet ────────────────────────────────────────────────────────
# MetaMask address to receive arbitrage profits
PROFIT_WALLET=0x...your_profit_wallet_address...

# ─── RPC Configuration ────────────────────────────────────────────────────
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}

# ─── Server Configuration ─────────────────────────────────────────────────
PORT=3000
NODE_ENV=production

# ─── Scanner Configuration ───────────────────────────────────────────────
MIN_PROFIT_USD=2
MAX_SLIPPAGE_PCT=0.5
MAX_VOLATILITY_PCT=5
MAX_GAS_GWEI=200
TRADE_AMOUNT_MATIC=1000

# ─── Logging ──────────────────────────────────────────────────────────────
LOG_LEVEL=info
EOF

# Secure the .env file
chmod 600 .env
```

### Get Alchemy API Key

1. Go to [alchemy.com](https://alchemy.com)
2. Sign up (free tier available)
3. Create a new app for Polygon Mainnet
4. Copy the API key

### Get Private Key

1. Open MetaMask
2. Click account menu → Account details
3. Click "Export Private Key"
4. Copy the key (starts with `0x`)

---

## Step 5: Deploy Smart Contract

```bash
# Compile contract
cd contracts
npx hardhat compile

# Deploy to Polygon Mainnet
npx hardhat run scripts/deploy.ts --network polygon

# Output will show: "EliteAntArb deployed to: 0x..."
# Save this address — you'll need it for the keeper config

cd ..
```

---

## Step 6: Create Systemd Services

### Scanner Service

```bash
sudo tee /etc/systemd/system/elite-scanner.service > /dev/null << 'EOF'
[Unit]
Description=Elite MEV Scanner (Rust)
After=network.target
Wants=elite-keeper.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mev-arb-bot
Environment="ALCHEMY_API_KEY=<your-key>"
ExecStart=/home/ubuntu/mev-arb-bot/scanner-rust/target/release/elite-scanner
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### Keeper Service

```bash
sudo tee /etc/systemd/system/elite-keeper.service > /dev/null << 'EOF'
[Unit]
Description=Elite MEV Keeper (Node.js)
After=network.target elite-scanner.service
Requires=elite-scanner.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mev-arb-bot
EnvironmentFile=/home/ubuntu/mev-arb-bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### Enable Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable elite-scanner elite-keeper
sudo systemctl start elite-scanner elite-keeper

# Check status
sudo systemctl status elite-scanner
sudo systemctl status elite-keeper

# View logs
sudo journalctl -u elite-scanner -f
sudo journalctl -u elite-keeper -f
```

---

## Step 7: Build and Start Server

```bash
# Build the Node.js backend
pnpm build

# Start the server
pnpm start

# Or use PM2 for process management
sudo npm install -g pm2
pm2 start dist/index.js --name "mev-bot"
pm2 save
pm2 startup
```

---

## Step 8: Verify Deployment

### Check Scanner

```bash
# Should see WebSocket connection and pool subscriptions
curl http://localhost:8080/metrics

# Expected output:
# scanner_scan_count 1234
# scanner_opportunities_detected 45
# scanner_pool_subscriptions 20
```

### Check Keeper

```bash
# Should see API endpoints responding
curl http://localhost:3000/api/health

# Expected output:
# {"ok": true, "timestamp": 1234567890}
```

### Check Bot Status

```bash
curl http://localhost:3000/api/bot/status

# Expected output:
# {
#   "running": true,
#   "scanCount": 1234,
#   "gasGwei": 45.5,
#   "maticPriceUsd": 0.85,
#   "networkStatus": "connected",
#   "opportunities": [...],
#   "subscribedPools": 20
# }
```

---

## Step 9: Connect Android App

1. Open the MEV Bot app on your phone
2. Go to **Settings** → **VPS Connection**
3. Enter:
   - **VPS URL:** `http://<your-vps-ip>:3000`
   - **Alchemy API Key:** (same as server)
4. Tap **Connect**
5. Go to **Dashboard** → Tap **START BOT**

---

## Step 10: Monitor and Maintain

### View Real-Time Logs

```bash
# Scanner logs
sudo journalctl -u elite-scanner -f

# Keeper logs
sudo journalctl -u elite-keeper -f

# Combined logs
sudo journalctl -u elite-scanner -u elite-keeper -f
```

### Check Disk Space

```bash
df -h
# Keep at least 10GB free
```

### Monitor Gas Spending

```bash
# Check wallet balance
curl http://localhost:3000/api/bot/status | jq '.gasGwei'

# If gas is too high, adjust MAX_GAS_GWEI in .env and restart
```

### Restart Services

```bash
sudo systemctl restart elite-scanner elite-keeper
```

---

## Troubleshooting

### Scanner Won't Start

```bash
# Check Alchemy API key
curl -X POST https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Should return: {"result":"0x..."}
```

### No Opportunities Detected

```bash
# Check pool subscriptions
curl http://localhost:8080/metrics | grep pool_subscriptions

# Should be > 0. If 0:
# 1. Verify Alchemy key is correct
# 2. Check WebSocket connection: sudo journalctl -u elite-scanner -f
# 3. Ensure Polygon network is accessible
```

### High Gas Prices

```bash
# If gas > MAX_GAS_GWEI, trades will be skipped
# Either:
# 1. Wait for gas to drop
# 2. Increase MAX_GAS_GWEI in .env (higher cost per trade)
# 3. Reduce TRADE_AMOUNT_MATIC (smaller trades = less gas impact)
```

### Transaction Failures

```bash
# Check wallet balance
curl http://localhost:3000/api/bot/status | jq '.walletBalance'

# Must have >= 0.5 MATIC for gas
# Send MATIC to wallet address from MetaMask
```

---

## Security Best Practices

1. **Never commit `.env` to git** — add to `.gitignore`
2. **Use a dedicated bot wallet** — not your main wallet
3. **Limit VPS access** — only open ports 22, 3000, 8080, 5000
4. **Use firewall rules** — restrict API access by IP if possible
5. **Monitor logs regularly** — watch for errors or unusual activity
6. **Keep private key secure** — consider using AWS Secrets Manager or HashiCorp Vault in production

---

## Performance Tuning

### Increase Scan Frequency

In `server/scanner.ts`, reduce the interval:

```typescript
this.gasRefreshTimer = setInterval(() => this.refreshGasAndPrices(), 15_000); // was 30_000
```

### Increase Trade Amount

In `.env`:

```
TRADE_AMOUNT_MATIC=5000  # was 1000
```

### Lower Profit Threshold

In `.env`:

```
MIN_PROFIT_USD=1  # was 2
```

---

## Next Steps

1. **Monitor profits** — Check trade history daily
2. **Adjust parameters** — Tune MIN_PROFIT_USD, MAX_SLIPPAGE_PCT based on results
3. **Expand DEX pairs** — Add more token pairs to `SCAN_PAIRS` in `server/scanner.ts`
4. **Integrate Flashbots** — Replace Alchemy RPC with Flashbots for private mempool access
5. **Add push notifications** — Get alerts when high-confidence opportunities are detected

---

## Support

- **Issues:** Check logs with `sudo journalctl -u elite-scanner -f`
- **Questions:** Review the REANALYSIS.md and PRODUCTION_README.md files
- **Debugging:** Run tests locally with `pnpm test` before deploying changes

---

## Deployment Checklist

- [ ] VPS provisioned (Ubuntu 22.04, 2GB+ RAM)
- [ ] Dependencies installed (Node.js, Rust, pnpm)
- [ ] Project cloned and dependencies installed
- [ ] `.env` file created with all secrets
- [ ] Smart contract deployed to Polygon
- [ ] Systemd services created and enabled
- [ ] Server builds and starts without errors
- [ ] Scanner connects to Alchemy WebSocket
- [ ] Keeper receives opportunities from scanner
- [ ] Android app connects to VPS
- [ ] First test trade executed successfully
- [ ] Logs monitored for 24 hours
- [ ] Profits verified on blockchain

---

**Deployment complete!** Your MEV arbitrage bot is now live on Polygon mainnet.
