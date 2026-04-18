# Elite MEV Arbitrage Bot — Architecture Overview

Complete system architecture showing all components, data flows, and interactions.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          POLYGON MAINNET (L1)                               │
│                                                                               │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │   QuickSwap V2       │  │   SushiSwap V2       │  │  AAVE V3 Pool    │  │
│  │   (DEX A)            │  │   (DEX B)            │  │  (Flash Loans)   │  │
│  │                      │  │                      │  │                  │  │
│  │  WMATIC/USDC Pool    │  │  WMATIC/USDC Pool    │  │  Flash Loan      │  │
│  │  WETH/USDC Pool      │  │  WETH/USDC Pool      │  │  Provider        │  │
│  │  WBTC/USDC Pool      │  │  WBTC/USDC Pool      │  │                  │  │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────┘  │
│           ▲                          ▲                         ▲              │
│           │                          │                         │              │
│           └──────────────┬───────────┴─────────────┬───────────┘              │
│                          │                         │                         │
│                  ┌───────▼─────────────────────────▼────────┐               │
│                  │   EliteAntArb.sol (Smart Contract)      │               │
│                  │                                          │               │
│                  │  - Flash Loan Receiver                  │               │
│                  │  - Atomic Swap Executor                 │               │
│                  │  - Profit Calculator                    │               │
│                  │  - Owner Emergency Controls             │               │
│                  └──────────────────────────────────────────┘               │
│                                      ▲                                       │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │
                                       │ executeArb()
                                       │ (signed tx)
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
        ┌───────────▼────────────┐          ┌────────────▼────────────┐
        │   VPS BACKEND LAYER    │          │   MOBILE APP LAYER     │
        │                        │          │                        │
        │  ┌──────────────────┐  │          │  ┌──────────────────┐  │
        │  │  Rust Scanner    │  │          │  │  React Native    │  │
        │  │  (elite-scanner) │  │          │  │  + Expo          │  │
        │  │                  │  │          │  │                  │  │
        │  │ • WebSocket Sub  │  │          │  │ • Dashboard      │  │
        │  │ • Pool Listener  │  │          │  │ • Opportunities  │  │
        │  │ • Price Calc     │  │          │  │ • History        │  │
        │  │ • Metrics        │  │          │  │ • Deploy         │  │
        │  │ • ZMQ PUSH       │  │          │  │ • Settings       │  │
        │  └────────┬─────────┘  │          │  └────────┬─────────┘  │
        │           │            │          │           │            │
        │  ┌────────▼─────────┐  │          │           │            │
        │  │  Node.js Keeper  │  │          │           │            │
        │  │  (elite-keeper)  │  │          │           │            │
        │  │                  │  │          │           │            │
        │  │ • Risk Engine    │  │          │           │            │
        │  │ • Bundle Builder │  │          │           │            │
        │  │ • Activator      │  │          │           │            │
        │  │ • REST API       │  │          │           │            │
        │  │ • WebSocket Push │  │          │           │            │
        │  │ • ZMQ PULL       │  │          │           │            │
        │  └────────┬─────────┘  │          │           │            │
        │           │            │          │           │            │
        └───────────┼────────────┘          └───────────┼────────────┘
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      │
                         REST API + WebSocket
                         (HTTP/HTTPS)
                                      │
                    ┌─────────────────▼──────────────────┐
                    │   Alchemy Polygon RPC              │
                    │   (eth_subscribe, eth_call)        │
                    └────────────────────────────────────┘
```

---

## Data Flow: Opportunity Detection → Execution

```
1. POOL EVENT DETECTION (Rust Scanner)
   ├─ WebSocket subscription to Sync/Swap events
   ├─ Decode event data (reserve0, reserve1)
   ├─ Calculate token prices from reserves
   └─ Emit opportunity to Keeper via ZMQ PUSH

2. RISK FILTERING (Node.js Keeper)
   ├─ Receive opportunity from scanner
   ├─ Validate 4 safety conditions:
   │  ├─ Gas price <= MAX_GAS_GWEI?
   │  ├─ Slippage <= MAX_SLIPPAGE_PCT?
   │  ├─ Volatility <= MAX_VOLATILITY_PCT?
   │  └─ Net profit >= MIN_PROFIT_USD?
   ├─ Calculate confidence score
   ├─ Rank by profit (descending)
   └─ Broadcast to Android app via WebSocket

3. TRADE EXECUTION (Keeper Activator)
   ├─ User approves high-confidence opportunity
   ├─ Build flash loan calldata
   ├─ Sign transaction with private key
   ├─ Submit to EliteAntArb contract
   ├─ Contract executes atomically:
   │  ├─ Borrow from AAVE V3 flash loan
   │  ├─ Swap on DEX A (buy low)
   │  ├─ Swap on DEX B (sell high)
   │  ├─ Repay flash loan + fee
   │  └─ Transfer profit to wallet
   └─ Record trade in history

4. MONITORING (Android App)
   ├─ Display live opportunities
   ├─ Show P&L updates
   ├─ Track transaction status
   └─ Log all trades
```

---

## Component Details

### 1. Rust Elite Scanner

**Purpose:** Ultra-low-latency pool event listener

**Technology:** Tokio async runtime, ethers-rs

**Key Functions:**
- Subscribe to Sync/Swap events via WebSocket
- Decode Uniswap V2 pool state
- Calculate token prices from reserves
- Filter by slippage and volatility
- Send opportunities to Keeper via ZMQ

**Performance:**
- Event detection: <50ms
- Price calculation: <10ms
- Total latency: <100ms per opportunity

**Metrics Exposed:**
- `scanner_scan_count` — total scans
- `scanner_opportunities_detected` — opportunities found
- `scanner_pool_subscriptions` — active pool listeners

---

### 2. Node.js Keeper Service

**Purpose:** Risk validation and trade execution

**Technology:** Express.js, ethers.js, ws

**Key Functions:**
- Receive opportunities from scanner
- Apply 4-layer risk filter
- Build flash loan calldata
- Sign and submit transactions
- Broadcast state to Android app

**REST API Endpoints:**
- `GET /api/health` — health check
- `GET /api/bot/status` — current state
- `GET /api/bot/opportunities` — ranked opportunities
- `GET /api/bot/history` — trade history
- `POST /api/bot/start` — start scanning
- `POST /api/bot/stop` — stop scanning
- `POST /api/bot/execute` — execute trade

**WebSocket Events:**
- `state` — bot state update
- `opportunity` — new opportunity detected
- `trade` — trade executed

---

### 3. Solidity EliteAntArb Contract

**Purpose:** On-chain atomic arbitrage execution

**Technology:** Solidity 0.8.24, AAVE V3 Flash Loans

**Key Functions:**
- `executeArb()` — initiate flash loan
- `executeOperation()` — atomic swap logic
- `onFlashLoan()` — flash loan callback

**Safety Features:**
- Slippage guard: revert if profit < minProfit
- Emergency pause: owner can pause contract
- Owner-only withdraw: recover stuck funds

**Gas Optimization:**
- Minimal state changes
- Batch operations
- Efficient calldata encoding

---

### 4. React Native Android App

**Purpose:** User control and monitoring interface

**Technology:** React Native, Expo, TypeScript, NativeWind

**Screens:**
1. **Dashboard** — Bot status, P&L, start/stop button
2. **Scan** — Live opportunity list with confidence scores
3. **History** — Executed trades with details
4. **Deploy** — Smart contract deployment interface
5. **Settings** — API key, risk parameters, wallet config

**State Management:**
- React Context + useReducer
- AsyncStorage for persistence
- TanStack Query for server data

---

### 5. Backend Server

**Purpose:** API gateway and WebSocket relay

**Technology:** Express.js, Node.js

**Responsibilities:**
- Expose REST API for app
- Relay WebSocket events
- Manage bot state
- Handle authentication

---

## Data Structures

### Opportunity

```typescript
interface Opportunity {
  id: string;                    // Unique identifier
  tokenIn: string;               // Buy token address
  tokenOut: string;              // Sell token address
  buyDex: "QuickSwap" | "SushiSwap";
  sellDex: "QuickSwap" | "SushiSwap";
  priceDiffPct: number;          // Price difference %
  slippagePct: number;           // Estimated slippage %
  volatilityPct: number;         // 24h volatility %
  gasGwei: number;               // Current gas price
  gasCostUsd: number;            // Gas cost in USD
  estimatedProfitUsd: number;    // Gross profit
  netProfitUsd: number;          // Profit after gas
  safe: boolean;                 // Passes all filters
  confidence: number;            // 0-100 score
}
```

### TradeRecord

```typescript
interface TradeRecord {
  id: string;
  txHash: string;
  status: "pending" | "confirmed" | "failed";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  gasUsed: number;
  gasCostUsd: number;
  estimatedProfitUsd: number;
  actualProfitUsd: number;
  confirmedAt: number;
  errorMessage?: string;
}
```

---

## Security Model

### Private Key Management
- Stored in `.env` file (never in code)
- Encrypted at rest on VPS
- Never transmitted over network
- Only used for signing transactions

### API Authentication
- Optional: API key in request headers
- Optional: IP whitelisting
- Optional: Rate limiting

### Smart Contract Security
- Flash loan callback validation
- Slippage protection (min profit check)
- Owner-only functions
- Emergency pause mechanism

---

## Performance Characteristics

| Component | Latency | Throughput | Notes |
|-----------|---------|-----------|-------|
| Scanner | <50ms | 100+ events/sec | WebSocket events |
| Risk Filter | <10ms | 1000+ ops/sec | In-memory filtering |
| Trade Execution | 5-15s | 1 tx/block | On-chain confirmation |
| API Response | <100ms | 100+ req/sec | REST endpoints |

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│              Ubuntu 22.04 VPS                       │
│                                                      │
│  ┌────────────────────────────────────────────┐    │
│  │  Systemd Services                          │    │
│  │                                            │    │
│  │  ┌──────────────────┐  ┌──────────────┐   │    │
│  │  │ elite-scanner    │  │ elite-keeper │   │    │
│  │  │ (Rust binary)    │  │ (Node.js)    │   │    │
│  │  └────────┬─────────┘  └──────┬───────┘   │    │
│  │           │                   │           │    │
│  │           └───────┬───────────┘           │    │
│  │                   │                       │    │
│  │           ┌───────▼────────┐              │    │
│  │           │  ZMQ IPC       │              │    │
│  │           │  (localhost)   │              │    │
│  │           └────────────────┘              │    │
│  │                                            │    │
│  │  ┌────────────────────────────────────┐   │    │
│  │  │  Nginx Reverse Proxy (SSL)         │   │    │
│  │  │  :443 → :3000 (API)                │   │    │
│  │  │  :443 → :8080 (Metrics)            │   │    │
│  │  └────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────┘    │
│                                                      │
│  Ports:                                             │
│  - 22   (SSH)                                       │
│  - 443  (HTTPS)                                     │
│  - 3000 (API, internal)                             │
│  - 8080 (Metrics, internal)                         │
│  - 5000 (Queen HTTP, internal)                      │
└─────────────────────────────────────────────────────┘
```

---

## Development Workflow

### Local Development

```bash
# Terminal 1: Start backend
pnpm dev:server

# Terminal 2: Start Expo dev server
pnpm dev:metro

# Terminal 3: Run tests
pnpm test --watch

# Terminal 4: Build Rust scanner
cd scanner-rust && cargo build --release
```

### VPS Deployment

```bash
# Build
pnpm build
cargo build --release

# Deploy
scp -r dist ubuntu@vps:/home/ubuntu/mev-arb-bot/
scp scanner-rust/target/release/elite-scanner ubuntu@vps:/home/ubuntu/mev-arb-bot/

# Start services
ssh ubuntu@vps "sudo systemctl restart elite-scanner elite-keeper"
```

---

## Monitoring & Observability

### Logs

```bash
# Scanner logs
sudo journalctl -u elite-scanner -f

# Keeper logs
sudo journalctl -u elite-keeper -f

# Combined
sudo journalctl -u elite-scanner -u elite-keeper -f
```

### Metrics

```bash
# Prometheus endpoint
curl http://localhost:8080/metrics

# Key metrics:
# - scanner_scan_count
# - scanner_opportunities_detected
# - keeper_trades_executed
# - keeper_trades_failed
# - keeper_total_profit_usd
```

### Alerts

- Gas price > MAX_GAS_GWEI
- No opportunities for 1 hour
- Transaction failure rate > 10%
- Wallet balance < 0.5 MATIC

---

## Future Enhancements

1. **Flashbots Integration** — Private mempool for MEV protection
2. **Uniswap V3 Support** — Concentrated liquidity pools
3. **Multi-chain** — Arbitrage across Ethereum, Optimism, Arbitrum
4. **Advanced Risk** — ML-based opportunity scoring
5. **Push Notifications** — Real-time alerts on mobile
6. **Dashboard** — Web-based monitoring interface

