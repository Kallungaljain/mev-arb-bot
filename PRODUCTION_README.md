# Elite MEV Arbitrage Bot — Complete Production System

This is a **fully functional, oracle-free MEV arbitrage system** combining a high-speed Rust scanner, a Node.js risk engine, a Solidity flash loan contract, and an Android control panel.

---

## System Architecture

```
Android App (Control Panel)
    ↓ REST + WebSocket
VPS (Production Backend)
    ├─ Rust Elite Scanner (50-200ms event loop)
    │  └─ WebSocket → Polygon DEX pools
    │     └─ Detects Sync events in real-time
    │
    └─ Node.js Keeper (Risk Engine + Bundle Builder)
       ├─ Receives opportunities from scanner
       ├─ Validates: gas, profit, slippage
       ├─ Builds flash loan calldata
       ├─ Signs and submits transactions
       └─ Broadcasts updates to Android app
           ↓
    Polygon Mainnet
       ├─ EliteAntArb Contract (Flash Loan Executor)
       ├─ AAVE V3 (Flash Loan Provider)
       ├─ QuickSwap + SushiSwap (DEX Pools)
       └─ Profit Wallet (Receives arbitrage profits)
```

---

## Components

### 1. Android App (`/app`)

**5 screens** on a dark trading terminal theme:

| Screen | Purpose |
|--------|---------|
| **Dashboard** | Live P&L, gas price, scan count, Start/Stop bot |
| **Scan** | Real-time opportunities with confidence scores |
| **History** | Executed trades with profit/loss, gas cost, tx hash |
| **Deploy** | Flash loan contract deployer with pre-deploy checklist |
| **Settings** | Alchemy API key, private key, wallet config, risk parameters |

**Features:**
- Connects to VPS via REST API + WebSocket
- Auto-reconnect with exponential backoff
- Persists settings locally (AsyncStorage)
- Responsive design for one-handed use
- Dark theme optimized for trading

### 2. Rust Elite Scanner (`/scanner`)

**High-speed opportunity detector** running on the VPS:

- **WebSocket subscriptions** to QuickSwap and SushiSwap V2 pools on Polygon
- **Event-driven**: Listens for `Sync` events (pool reserve changes)
- **Oracle-free**: Calculates prices directly from on-chain reserves
- **Risk filtering**: Slippage, volatility, gas cost, minimum profit
- **HTTP push**: Sends opportunities to Keeper service in real-time
- **Prometheus metrics**: Exposes scan count, opportunity count, reconnects

**Performance:**
- 50-200ms event loop (vs. 15s polling in local app)
- Handles 1000+ events/second from Polygon
- Automatic WebSocket reconnection

### 3. Node.js Keeper Service (`/keeper`)

**Risk engine and transaction executor** running on the VPS:

**Risk Engine:**
- Receives opportunities from Rust scanner
- Validates against live gas price (Alchemy)
- Recalculates profit with current MATIC price
- Checks slippage, volatility, minimum profit
- Skips trades if gas ≥ profit

**Bundle Builder:**
- Constructs flash loan calldata
- Encodes EliteAntArb.executeArb() parameters
- Sets minimum profit guard on-chain

**Flash Loan Activator:**
- Signs transactions with private key
- Submits to Polygon via Alchemy RPC
- Monitors for confirmation (30s timeout)
- Records actual gas used and profit

**WebSocket Push Server:**
- Broadcasts opportunities to Android app in real-time
- Sends trade updates (submitted, confirmed, failed)
- Pushes status updates (gas price, uptime, P&L)

**REST API:**
- `/api/status` — bot status and metrics
- `/api/opportunities` — recent opportunities
- `/api/history` — trade history
- `/api/bot/start`, `/api/bot/stop` — bot control
- `/api/bot/auto-execute` — toggle auto-execution
- `/api/execute` — manual trade execution
- `/api/wallet` — keeper wallet balance

### 4. Solidity Flash Loan Contract (`/contracts`)

**Oracle-free flash loan arbitrage executor** deployed on Polygon:

```solidity
function executeArb(
    address loanToken,
    uint256 loanAmount,
    address buyDex,
    address sellDex,
    address profitToken,
    uint256 minProfit
) external
```

**Flow:**
1. Request flash loan from AAVE V3 (0.05% fee)
2. Swap loanToken → profitToken on buyDex
3. Swap profitToken → loanToken on sellDex
4. Repay flash loan + fee
5. Send profit to configured wallet

**Safety:**
- `require(profit >= minProfit)` — on-chain guard
- Atomic execution (all-or-nothing)
- No external oracle dependencies

### 5. Deployment Infrastructure

**Docker Compose** orchestrates all services:

```yaml
services:
  scanner:    # Rust scanner (port 9090 metrics)
  keeper:     # Node.js keeper (port 3001 API)
  prometheus: # Monitoring (optional, port 9091)
```

**Included:**
- Dockerfiles for scanner and keeper
- docker-compose.yml with health checks
- prometheus.yml for metrics collection
- .env.example with all required variables

---

## Getting Started

### Prerequisites

1. **VPS** with Docker (Ubuntu 22.04 recommended)
2. **Alchemy API Key** (free tier: https://dashboard.alchemy.com)
3. **Ethereum Private Key** with ~0.5 MATIC for gas
4. **Deployed EliteAntArb Contract** on Polygon mainnet
5. **Profit Wallet Address** (where profits go)

### Quick Start

#### Step 1: Deploy VPS Backend

```bash
# SSH into VPS
ssh root@your-vps-ip

# Clone repo
git clone https://github.com/your-username/mev-arb-bot.git
cd mev-arb-bot

# Configure
cp .env.example .env
nano .env  # Edit with your values

# Deploy
docker compose up -d

# Verify
curl http://localhost:3001/health
```

#### Step 2: Connect Android App

1. Open the app → **Settings** → **VPS Connection**
2. Enter:
   - **VPS URL**: `http://your-vps-ip:3001`
   - **WebSocket Secret**: (from `.env` `WS_SECRET`)
3. Tap **Connect**

#### Step 3: Start Scanning

1. **Dashboard** → **START BOT**
2. Wait for opportunities in **Scan** tab
3. Tap an opportunity → **EXECUTE** (or enable auto-execute)
4. Monitor **History** for results

---

## Configuration

### Risk Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `MIN_PROFIT_WEI` | 500,000 | Min profit in USDC (6 decimals) = $0.50 |
| `MAX_SLIPPAGE_BPS` | 50 | Max slippage in basis points = 0.5% |
| `MAX_GAS_GWEI` | 200 | Skip if gas price exceeds this |
| `AUTO_EXECUTE` | false | Auto-execute profitable trades |

### DEX Pairs Scanned

The scanner monitors 10 token pairs on QuickSwap and SushiSwap:

- WMATIC / USDC
- WMATIC / USDT
- WMATIC / WETH
- WETH / USDC
- WETH / USDT
- WBTC / USDC
- LINK / USDC
- AAVE / USDC
- DAI / USDC
- WMATIC / DAI

---

## Monitoring

### Logs

```bash
# Keeper logs
docker compose logs -f keeper

# Scanner logs
docker compose logs -f scanner

# Filter for trades
docker compose logs keeper | grep "Tx submitted\|Tx confirmed"
```

### Metrics

```bash
# Scanner metrics (Prometheus)
curl http://localhost:9090/metrics | grep elite_scanner

# Keeper health
curl http://localhost:3001/health
```

### Dashboard

Access Prometheus dashboard (if enabled):

```bash
docker compose --profile monitoring up -d
# Then visit http://localhost:9091
```

---

## Production Hardening

### 1. Use Reverse Proxy (Nginx)

```bash
apt install nginx -y
# Configure with SSL/TLS for HTTPS
```

### 2. Enable SSL (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

### 3. Firewall

```bash
ufw enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
```

### 4. Monitoring & Alerts

- Set up Prometheus + Grafana for dashboards
- Configure alerts for high gas prices, failed trades
- Monitor wallet balance (auto-alert if low)

---

## Troubleshooting

### Scanner Not Detecting Opportunities

```bash
# Check logs
docker compose logs scanner | tail -20

# Verify Alchemy API key works
curl -X POST "https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Keeper Not Executing Trades

```bash
# Check logs for risk rejections
docker compose logs keeper | grep "Risk rejected\|Gas too high"

# Verify wallet has MATIC
curl http://localhost:3001/api/wallet \
  -H "X-WS-Secret: YOUR_WS_SECRET"
```

### Android App Can't Connect

```bash
# Test from VPS
curl http://127.0.0.1:3001/health

# Test from external IP
curl http://your-vps-ip:3001/health

# Check firewall
ufw status
```

---

## Performance Expectations

| Metric | Value |
|--------|-------|
| **Scan Latency** | 50-200ms (vs. 15s polling) |
| **Gas Cost** | ~350k gas (~$0.30-$1.00 USD on Polygon) |
| **Flash Loan Fee** | 0.05% (AAVE V3) |
| **Swap Fees** | 0.3% per swap (0.6% round-trip) |
| **Min Viable Spread** | ~0.65% (covers all fees) |
| **Typical Profit** | $0.50-$5.00 per trade |
| **Uptime** | 99.9% (with auto-reconnect) |

---

## Security Checklist

- [ ] Private key stored securely (never in version control)
- [ ] Secrets changed from defaults
- [ ] Firewall configured (only necessary ports open)
- [ ] SSL/TLS enabled (HTTPS)
- [ ] Regular backups of `.env`
- [ ] Monitor logs for suspicious activity
- [ ] Start with `AUTO_EXECUTE=false` for testing
- [ ] Wallet balance monitored (auto-alert if low)
- [ ] Contract address verified on PolygonScan

---

## Next Steps

### High-Impact Upgrades

1. **Flashbots Relay** — Use private mempool to avoid sandwich attacks
2. **Uniswap V3** — Add concentrated liquidity pools for more opportunities
3. **More DEX Pairs** — Expand to 50+ pairs for broader coverage
4. **Push Notifications** — Alert on high-confidence opportunities
5. **Backtesting** — Analyze historical data to optimize parameters

### Advanced Features

1. **Multi-wallet execution** — Distribute trades across multiple wallets
2. **Cross-chain arbitrage** — Bridge tokens and arbitrage across chains
3. **MEV protection** — Use MEV-resistant protocols (CoW Protocol, etc.)
4. **ML-based risk scoring** — Learn from past trades to improve filtering

---

## Support

For issues or questions:

1. Check logs: `docker compose logs -f`
2. Verify health: `/health` endpoint
3. Test connectivity: `curl` to API endpoints
4. Check Alchemy status: https://status.alchemy.com
5. Verify contract on PolygonScan

---

## License

MIT — Use freely for personal or commercial purposes.

---

**Built with:** Rust, Node.js, Solidity, React Native, TypeScript, Docker

**Deployed on:** Polygon Mainnet via Alchemy RPC

**Tested on:** Ubuntu 22.04 LTS, Docker 24+, Expo 54
