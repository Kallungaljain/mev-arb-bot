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
