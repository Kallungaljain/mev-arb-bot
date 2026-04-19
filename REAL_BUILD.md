# Real Production MEV Arbitrage Engine — Build Guide

## Overview

This document outlines the complete rebuild from simulation to production-grade real-world trading on Polygon mainnet.

## Phase 1: Real Rust Scanner with WebSocket Subscriptions

### What We're Building
- Rust async runtime (tokio) connecting to Alchemy WebSocket
- Real `eth_subscribe` to Sync events on QuickSwap and SushiSwap pools
- Actual reserve decoding and price calculation
- Cross-DEX spread detection
- HTTP status endpoint for monitoring
- ZeroMQ PUSH to Keeper service

### Key Differences from Simulation
| Aspect | Simulation | Real |
|--------|-----------|------|
| Data source | Hardcoded JSON | Alchemy WebSocket (live Polygon) |
| Pool events | Fake timer | Real Sync events from contracts |
| Price calculation | Hardcoded spreads | Actual reserve math (x*y=k) |
| Latency | 500ms polling | 50-200ms event-driven |
| Opportunities | Pre-generated list | Detected in real-time |

### Implementation Steps

1. **Create `scanner-prod/Cargo.toml`** with dependencies:
   - `tokio` — async runtime
   - `tokio-tungstenite` — WebSocket client
   - `ethers-rs` — Ethereum types and ABI decoding
   - `zmq` — ZeroMQ for IPC to Keeper
   - `axum` — HTTP server for status endpoint
   - `serde_json` — JSON parsing

2. **Implement WebSocket subscription**:
   ```rust
   // Connect to Alchemy WebSocket
   let wss_url = format!("wss://polygon-mainnet.g.alchemy.com/v2/{}", alchemy_key);
   let (ws_stream, _) = connect_async(&wss_url).await?;
   
   // Subscribe to Sync events on QuickSwap pool
   let filter = json!({
       "jsonrpc": "2.0",
       "id": 1,
       "method": "eth_subscribe",
       "params": ["logs", {
           "address": "0x5757371414417b8C6CAD0a0b9f7dd9Cf0a3D0cA0", // QuickSwap WMATIC/USDC
           "topics": ["0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"] // Sync event
       }]
   });
   ```

3. **Decode Sync events and extract reserves**:
   ```rust
   // Parse incoming Sync events
   // Extract reserve0 and reserve1 from event data
   // Calculate token prices using x*y=k formula
   // Compare prices across DEXes
   ```

4. **Detect arbitrage opportunities**:
   ```rust
   // For each token pair:
   // price_quickswap = reserve1_quick / reserve0_quick
   // price_sushiswap = reserve1_sushi / reserve0_sushi
   // spread = (price_quickswap - price_sushiswap) / price_sushiswap * 100
   // if spread > MIN_SPREAD_PCT: emit opportunity
   ```

5. **Push to Keeper via ZeroMQ**:
   ```rust
   let zmq_context = zmq::Context::new();
   let socket = zmq_context.socket(zmq::PUSH)?;
   socket.connect("tcp://127.0.0.1:5555")?;
   socket.send_multipart(&[b"opportunity", json_bytes], 0)?;
   ```

6. **HTTP status endpoint**:
   ```rust
   // GET /status → returns scanner state
   // {
   //   "connected": true,
   //   "pools_subscribed": 10,
   //   "opportunities_detected": 42,
   //   "last_sync_event": "2026-04-19T12:34:56Z",
   //   "uptime_seconds": 3600
   // }
   ```

---

## Phase 2: Real Node.js Keeper with Actual Trade Execution

### What We're Building
- ZeroMQ PULL socket receiving opportunities from scanner
- Risk engine validation (gas, slippage, volatility, profit)
- Bundle builder constructing flash loan calldata
- ethers.js transaction signing with private key
- Flashbots Relay integration for private mempool
- Real gas estimation and profit calculation
- HTTP API for Android app
- WebSocket push for live updates

### Key Differences from Simulation
| Aspect | Simulation | Real |
|--------|-----------|------|
| Opportunity source | Hardcoded | ZeroMQ from scanner |
| Risk validation | Skipped | Full 4-layer check |
| Transaction signing | Fake | Real ethers.js with private key |
| Submission method | Console log | Flashbots Relay or public RPC |
| Gas estimation | Hardcoded | `eth_estimateGas` from Polygon |
| Profit tracking | Simulated | Actual tx hash and on-chain receipt |

### Implementation Steps

1. **Create `keeper-prod/src/index.ts`**:
   ```typescript
   import zmq from "zeromq";
   import { ethers } from "ethers";
   import axios from "axios";
   
   // ZeroMQ PULL socket
   const sock = new zmq.Pull();
   await sock.bind("tcp://127.0.0.1:5555");
   
   // Polygon RPC provider
   const provider = new ethers.JsonRpcProvider(
     `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
   );
   
   // Signer with private key
   const signer = new ethers.Wallet(PRIVATE_KEY, provider);
   
   // Listen for opportunities
   for await (const [msg] of sock) {
     const opportunity = JSON.parse(msg.toString());
     await processOpportunity(opportunity);
   }
   ```

2. **Risk engine validation**:
   ```typescript
   async function validateRisk(opp: Opportunity): Promise<boolean> {
     // 1. Gas check
     const gasPrice = await provider.getGasPrice();
     const gasCostUSD = (gasPrice * 300000) / 1e18 * MATIC_PRICE_USD;
     if (gasCostUSD > opp.expectedProfit) return false;
     
     // 2. Slippage check
     if (opp.slippage > MAX_SLIPPAGE_PCT) return false;
     
     // 3. Volatility check
     if (opp.volatility24h > MAX_VOLATILITY_PCT) return false;
     
     // 4. Profit check
     if (opp.expectedProfit < MIN_PROFIT_USD) return false;
     
     return true;
   }
   ```

3. **Bundle builder**:
   ```typescript
   function buildFlashLoanCalldata(opp: Opportunity): string {
     // Construct EliteAntArb.executeArb() calldata
     // Encode: tokenBorrow, amountBorrow, tokenSwap, minProfit
     const iface = new ethers.Interface(ELITE_ANT_ABI);
     return iface.encodeFunctionData("executeArb", [
       opp.tokenBorrow,
       opp.amountBorrow,
       opp.tokenSwap,
       opp.minProfit
     ]);
   }
   ```

4. **Transaction execution**:
   ```typescript
   async function executeArbitrage(opp: Opportunity) {
     try {
       const tx = await signer.sendTransaction({
         to: ELITE_ANT_ADDRESS,
         data: buildFlashLoanCalldata(opp),
         gasLimit: 300000,
         gasPrice: await provider.getGasPrice()
       });
       
       const receipt = await tx.wait();
       
       // Record trade
       trades.push({
         txHash: receipt.transactionHash,
         timestamp: new Date(),
         tokenPair: opp.pair,
         expectedProfit: opp.expectedProfit,
         status: receipt.status === 1 ? "success" : "failed"
       });
     } catch (error) {
       console.error("Trade execution failed:", error);
     }
   }
   ```

5. **HTTP API for Android**:
   ```typescript
   app.get("/api/opportunities", (req, res) => {
     res.json(opportunities.slice(-50)); // Last 50 opportunities
   });
   
   app.get("/api/trades", (req, res) => {
     res.json(trades.slice(-50)); // Trade history
   });
   
   app.post("/api/execute", async (req, res) => {
     const { opportunityId } = req.body;
     const opp = opportunities.find(o => o.id === opportunityId);
     if (!opp) return res.status(404).json({ error: "Not found" });
     
     await executeArbitrage(opp);
     res.json({ status: "executing" });
   });
   ```

---

## Phase 3: Deploy Smart Contract to Polygon Testnet

### Contract Requirements
- Flash loan from AAVE V3 on Polygon Mumbai
- Atomic swap: DEX A → DEX B
- Profit guard: revert if profit < minProfit
- Owner-only functions: pause, withdraw

### Deployment Steps

1. **Compile contract**:
   ```bash
   cd contracts
   npx hardhat compile
   ```

2. **Deploy to Mumbai testnet**:
   ```bash
   npx hardhat run scripts/deploy.ts --network mumbai
   ```

3. **Verify on PolygonScan**:
   ```bash
   npx hardhat verify --network mumbai <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
   ```

4. **Test with real flash loan**:
   ```bash
   npx hardhat test --network mumbai
   ```

---

## Phase 4: Wire Android App to Real Keeper API

### Changes to Mobile App

1. **Update `lib/keeper-api.ts`**:
   ```typescript
   export async function fetchLiveOpportunities() {
     const response = await fetch(`${KEEPER_URL}/api/opportunities`);
     return response.json();
   }
   
   export async function executeOpportunity(opportunityId: string) {
     const response = await fetch(`${KEEPER_URL}/api/execute`, {
       method: "POST",
       body: JSON.stringify({ opportunityId })
     });
     return response.json();
   }
   ```

2. **Update Dashboard**:
   - Display real opportunities from keeper API
   - Show actual prices and spreads
   - Display real P&L from executed trades
   - Show live gas price from Polygon

3. **Update Settings**:
   - Keeper URL input (VPS address)
   - Real Alchemy API key validation
   - Private key storage (encrypted)
   - Risk parameters (min profit, max slippage, etc.)

---

## Phase 5: End-to-End Testing

### Test Sequence

1. **Start scanner**:
   ```bash
   cd scanner-prod
   cargo run --release
   ```

2. **Start keeper**:
   ```bash
   cd keeper-prod
   npm start
   ```

3. **Connect Android app**:
   - Enter keeper URL (localhost or VPS IP)
   - Enter Alchemy API key
   - Enter private key (testnet account with MATIC)

4. **Monitor live data**:
   - Watch opportunities appear in real-time
   - Verify prices match Polygon mainnet
   - Check gas estimates are accurate

5. **Execute test trade**:
   - Select a safe opportunity (high confidence)
   - Tap "Execute"
   - Monitor tx hash on PolygonScan
   - Verify profit in wallet

---

## Environment Variables

```bash
# .env
ALCHEMY_KEY=your_alchemy_api_key
PRIVATE_KEY=0x... # Testnet account private key
ELITE_ANT_ADDRESS=0x... # Deployed contract address
MIN_PROFIT_USD=5
MAX_SLIPPAGE_PCT=0.5
MAX_VOLATILITY_PCT=5
MAX_GAS_GWEI=100
KEEPER_URL=http://localhost:3000
```

---

## Success Criteria

✅ Scanner connects to Alchemy and receives Sync events  
✅ Keeper receives opportunities from scanner  
✅ Android app displays real opportunities with actual prices  
✅ Execute button triggers real transaction  
✅ Transaction appears on PolygonScan  
✅ Profit flows to wallet  
✅ Trade recorded in history with actual gas cost  

---

## Timeline

- **Phase 1 (Rust Scanner)**: 2 hours
- **Phase 2 (Node.js Keeper)**: 2.5 hours
- **Phase 3 (Smart Contract)**: 1 hour
- **Phase 4 (Android Integration)**: 1.5 hours
- **Phase 5 (Testing)**: 1 hour

**Total: 8 hours of focused engineering**

