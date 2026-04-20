# Elite MEV Arbitrage Bot — TODO

- [x] Dark trading theme (navy/cyan/neon green palette)
- [x] 5-tab navigation: Dashboard, Opportunities, History, Deploy, Settings
- [x] Dashboard: bot status, live P&L, gas price, opportunity count, start/stop button
- [x] Opportunities screen: live arb opportunity list with profit/gas/slippage scores
- [x] Trade History screen: executed trades with P&L, gas, status
- [x] Deploy Contract screen: flash loan contract deployer with wallet config
- [x] Settings screen: Alchemy API key, min profit, max slippage, volatility limit
- [x] Alchemy API integration: Polygon gas tracker, token prices
- [x] DEX pool scanner: Uniswap V2/V3 on Polygon (QuickSwap, SushiSwap)
- [x] Arbitrage engine: cross-DEX price comparison
- [x] Slippage calculator: impact based on trade size vs pool liquidity
- [x] Volatility filter: skip high-volatility tokens
- [x] Profit-vs-gas filter: skip if gas cost >= expected profit
- [x] Auto-execute engine: sign and submit profitable trades
- [x] App logo and branding
- [x] AsyncStorage persistence for settings

## VPS Backend Upgrade

- [x] VPS scanner service: WebSocket pool event subscriptions (replace 15s polling)
- [x] Sync/Swap event listener on QuickSwap + SushiSwap pool contracts
- [x] Pending transaction mempool watcher via eth_subscribe
- [x] Opportunity engine running on VPS (sub-200ms response)
- [x] REST API server: GET /status, GET /opportunities, GET /history, POST /bot/start, POST /bot/stop
- [x] WebSocket push server: real-time opportunity + state updates to Android app
- [x] Android app: VPS connection screen (enter VPS URL + API secret)
- [x] Android app: switch from local scanner to VPS WebSocket feed
- [x] Android app: connection status indicator (VPS connected/disconnected)
- [x] VPS deployment guide (README)
- [x] Integration tests for API endpoints

## Bug Fixes

- [x] Fix Alchemy connection error when scanning starts
- [x] Fix scanning engine not producing opportunities
- [x] Ensure CORS/network errors don't block mobile app API calls
- [x] Validate Alchemy API key format before attempting connection

## Crash Fix

- [x] Fix app crash on Android startup
- [x] Ensure all imports resolve correctly (no missing modules)
- [x] Fix any runtime errors in BotProvider / context
- [x] Ensure APK build succeeds cleanly

## Production Stack — Full VPS + On-Chain System

### Solidity Flash Loan Contract
- [x] Oracle-free EliteAntArb contract (AAVE V3 flash loan on Polygon)
- [x] On-chain price calculation from pool reserves (no Chainlink/oracle)
- [x] Atomic arbitrage: borrow → swap DEX A → swap DEX B → repay → profit
- [x] Slippage guard: revert if profit < minProfit (set by owner)
- [x] Emergency pause and owner-only withdraw
- [x] Hardhat project with deploy script and tests

### Rust Elite Scanner
- [x] Rust workspace with tokio async runtime
- [x] WebSocket subscription to Polygon via Alchemy (eth_subscribe Sync/Swap events)
- [x] Pool reserve decoder (Uniswap V2 ABI)
- [x] Cross-DEX price comparison engine (QuickSwap vs SushiSwap)
- [x] Slippage + volatility + gas filter in Rust
- [x] IPC channel to Keeper (Unix socket or HTTP)
- [x] Prometheus metrics endpoint

### Node.js Keeper Service
- [x] Risk engine: validate opportunity from Rust scanner
- [x] Bundle builder: construct flash loan calldata
- [x] Flash loan activator: sign + submit tx via ethers.js
- [x] WebSocket push server: broadcast to Android app
- [x] REST API: /status /opportunities /history /start /stop
- [x] Keeper config: min profit, max gas, max slippage, private key (env)

### VPS Deployment
- [x] Docker Compose: scanner (Rust) + keeper (Node) + nginx reverse proxy
- [x] .env.example with all required variables
- [x] Systemd service files for production
- [x] VPS setup guide (Ubuntu 22.04) — VPS_DEPLOYMENT.md complete
- [x] Nginx config with SSL termination


## Phase 1: Critical Blockers (Week 1) — COMPLETE ✅

### Blocker 1: Contract Deployment & Implementation
- [x] Deploy EliteAntArb contract to Polygon Mumbai testnet
- [x] Implement full executeOperation() with proper swap execution
- [x] Add swap router integration (QuickSwap + SushiSwap)
- [x] Test executeOperation() with mock data
- [x] Verify profit capture on-chain
- [x] Document contract address and ABI

### Blocker 2: Calldata Encoding
- [x] Fix calldata encoding in Keeper (currently just addresses + amounts)
- [x] Build proper swap instructions for each DEX
- [x] Encode swap paths with token amounts
- [x] Implement swap approval logic in contract
- [x] Test with real pool data
- [x] Verify contract receives correct calldata

### Blocker 3: Profit Simulation
- [x] Install revm (Rust EVM simulator)
- [x] Implement pre-execution simulation in Keeper
- [x] Simulate full trade flow (borrow → swap → swap → repay)
- [x] Account for slippage + AAVE fee (0.09%) + gas
- [x] Only execute if simulated profit > threshold
- [x] Add simulation results to API response

### Blocker 4: Flashbots Integration
- [x] Add Flashbots Relay client to Keeper
- [x] Replace public mempool with Flashbots private bundles
- [x] Implement bundle building and submission
- [x] Add MEV protection (skip if high risk)
- [x] Test with real Flashbots Relay
- [x] Monitor bundle inclusion rate

### Testing & Validation
- [x] End-to-end test on Mumbai testnet
- [x] Execute 5 real trades with small amounts
- [x] Verify profit capture for each trade
- [x] Monitor for sandwich attacks
- [x] Validate gas costs vs estimates
- [x] Check transaction success rate

### Documentation
- [x] Document contract deployment process
- [x] Update Keeper API documentation
- [x] Create troubleshooting guide
- [x] Document Flashbots integration
- [x] Create Phase 1 completion report
