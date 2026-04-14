# Elite MEV Bot — VPS Deployment Guide

This guide walks you through deploying the complete Elite MEV arbitrage system to a VPS.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        VPS (Polygon RPC)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Rust Elite Scanner (50-200ms event loop)                │  │
│  │ • WebSocket subscriptions to QuickSwap + SushiSwap pools│  │
│  │ • Detects Sync events in real-time                      │  │
│  │ • Calculates arbitrage opportunities                    │  │
│  │ • Sends to Keeper via HTTP POST                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Node.js Keeper Service (Risk Engine + Bundle Builder)   │  │
│  │ • Receives opportunities from scanner                   │  │
│  │ • Runs final risk validation (gas, profit, slippage)    │  │
│  │ • Builds flash loan calldata                            │  │
│  │ • Signs and submits tx to Polygon                       │  │
│  │ • Broadcasts updates to Android app via WebSocket       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Polygon Mainnet                                          │  │
│  │ • EliteAntArb contract executes flash loan arb          │  │
│  │ • AAVE V3 flash loan + swap atomically                  │  │
│  │ • Profit sent to configured wallet                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         ↑                                          ↑
         │ WebSocket updates                       │
         │ (opportunities, trades, status)         │
         │                                          │ Alchemy API
         │                                          │
    ┌────────────────────────────────────────────────────┐
    │      Android App (Dashboard + Control Panel)       │
    │ • View live opportunities                          │
    │ • Monitor P&L and gas prices                       │
    │ • Deploy flash loan contract                       │
    │ • Start/stop bot, enable auto-execute              │
    └────────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **VPS with Docker & Docker Compose**
   - Ubuntu 22.04 LTS recommended
   - At least 2 CPU cores, 4 GB RAM
   - 20 GB disk space

2. **Alchemy API Key**
   - Get free tier at https://dashboard.alchemy.com
   - Create a Polygon mainnet app

3. **Ethereum Private Key**
   - The wallet that will sign transactions
   - Must have ~0.5 MATIC for gas fees
   - **Never share this key**

4. **Deployed EliteAntArb Contract**
   - Deploy the Solidity contract first (see `contracts/` directory)
   - Note the contract address on Polygon mainnet

5. **Profit Wallet Address**
   - MetaMask or any Ethereum address
   - Where arbitrage profits will be sent

---

## Step 1: Prepare the VPS

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

---

## Step 2: Clone and Configure

```bash
# Clone the repo (or upload via SCP)
git clone https://github.com/your-username/mev-arb-bot.git
cd mev-arb-bot

# Create .env file from template
cp .env.example .env

# Edit .env with your values
nano .env
```

**Required .env values:**

```env
ALCHEMY_API_KEY=alchemy_polygon_xxx
PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0x...
PROFIT_WALLET=0x...
KEEPER_SECRET=your-random-secret-1
WS_SECRET=your-random-secret-2
AUTO_EXECUTE=false  # Start with false, enable after testing
```

Generate random secrets:
```bash
openssl rand -hex 32
```

---

## Step 3: Deploy with Docker Compose

```bash
# Build and start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f keeper
docker compose logs -f scanner

# Stop
docker compose down
```

---

## Step 4: Verify Deployment

### Check Keeper Health
```bash
curl http://localhost:3001/health
# Expected: {"status":"ok","uptime":123.45}
```

### Check Scanner Metrics
```bash
curl http://localhost:9090/metrics | grep elite_scanner
# Expected: elite_scanner_sync_events_total 1234
```

### Monitor Logs
```bash
docker compose logs -f keeper | grep -E "Tx submitted|Tx confirmed"
```

---

## Step 5: Wire Android App to VPS

In the Android app:

1. Go to **Settings** → **VPS Connection**
2. Enter:
   - **VPS URL**: `http://your-vps-ip:3001`
   - **WebSocket Secret**: The value from `WS_SECRET` in .env
3. Tap **Connect**
4. Go to **Dashboard** — you should see "VPS Connected ✓"

---

## Step 6: Test the System

### Test 1: Manual Execution (Auto-Execute OFF)

1. Start the bot: Dashboard → **START BOT**
2. Wait for an opportunity to appear in the **Scan** tab
3. Tap the opportunity → **EXECUTE**
4. Monitor the transaction in **History**

### Test 2: Auto-Execute (After Confidence Check)

1. Settings → toggle **Auto-Execute: ON**
2. Start the bot
3. The Keeper will automatically execute profitable trades
4. Monitor **History** and **Dashboard P&L**

---

## Step 7: Production Hardening

### 1. Use a Reverse Proxy (Nginx)

```bash
# Install Nginx
apt install nginx -y

# Create config
cat > /etc/nginx/sites-available/elite-keeper << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# Enable and restart
ln -s /etc/nginx/sites-available/elite-keeper /etc/nginx/sites-enabled/
nginx -s reload
```

### 2. Enable SSL (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

### 3. Set Up Monitoring

```bash
# Enable Prometheus in docker-compose
docker compose --profile monitoring up -d

# Access at http://localhost:9091
```

### 4. Firewall Rules

```bash
ufw enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3001/tcp  # Keeper (internal only, ideally)
```

---

## Troubleshooting

### Scanner Not Detecting Opportunities

```bash
# Check scanner logs
docker compose logs scanner | tail -20

# Verify Alchemy API key
curl "https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Keeper Not Executing Trades

```bash
# Check keeper logs
docker compose logs keeper | grep -i "error\|risk\|gas"

# Verify wallet balance
curl http://localhost:3001/api/wallet \
  -H "X-WS-Secret: YOUR_WS_SECRET"
```

### Android App Can't Connect to VPS

```bash
# Test connectivity from VPS
curl http://127.0.0.1:3001/health

# Test from external IP
curl http://your-vps-ip:3001/health

# Check firewall
ufw status
```

---

## Maintenance

### Update the System

```bash
git pull origin main
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Backup Configuration

```bash
cp .env .env.backup
docker compose logs > logs-backup.txt
```

### Monitor Gas Costs

```bash
# Check daily gas spending
docker compose logs keeper | grep "gas_cost_usd" | awk '{sum+=$NF} END {print "Total: $" sum}'
```

---

## Security Checklist

- [ ] Private key stored securely (never in version control)
- [ ] Secrets changed from defaults
- [ ] Firewall configured (only necessary ports open)
- [ ] SSL/TLS enabled (HTTPS)
- [ ] Regular backups of .env file
- [ ] Monitor logs for suspicious activity
- [ ] Set `AUTO_EXECUTE=false` until fully tested
- [ ] Start with small `MIN_PROFIT_WEI` for testing

---

## Support & Debugging

For issues, check:

1. **Logs**: `docker compose logs -f`
2. **Health endpoints**: `/health`, `/metrics`
3. **Alchemy status**: https://status.alchemy.com
4. **Polygon status**: https://polygonscan.com

---

## Next Steps

1. **Optimize gas**: Use Flashbots Relay for private mempool
2. **Expand pairs**: Add more DEX pairs to scanner
3. **Add notifications**: Push alerts on trade execution
4. **Backtest**: Run historical analysis on past opportunities
