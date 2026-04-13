# Elite MEV Arbitrage Bot — Design Document

## Brand & Color Palette
- **Background**: #0A0E1A (deep navy black — trading terminal feel)
- **Surface**: #111827 (dark card)
- **Primary**: #00E5FF (electric cyan — profit/active)
- **Success**: #00FF88 (neon green — profit positive)
- **Warning**: #FFB800 (amber — caution)
- **Error**: #FF3B5C (red — loss/danger)
- **Muted**: #4B5563 (dim gray)
- **Foreground**: #E2E8F0 (light text)

## Screen List
1. **Dashboard** — Bot status, live P&L, gas price, active opportunities count, quick start/stop
2. **Opportunities** — Real-time list of detected arb opportunities with profit/gas/slippage scores
3. **Trade History** — Executed trades, profit per trade, gas spent, success/fail status
4. **Deploy Contract** — Flash loan contract deployer: enter wallet key, profit wallet, deploy to Polygon
5. **Settings** — Alchemy API key, min profit threshold, max slippage, volatility limit, wallet config

## Key User Flows
- **Start Bot**: Dashboard → tap Start → bot begins scanning → opportunities appear in Opportunities tab
- **Auto-execute**: Opportunity passes risk filter → auto-executed → appears in Trade History
- **Deploy Contract**: Deploy tab → enter config → Deploy → contract address shown
- **Configure Risk**: Settings → set min profit, max slippage, gas limit → Save

## Tab Navigation
- Tab 1: Dashboard (home icon)
- Tab 2: Opportunities (flash/bolt icon)
- Tab 3: History (clock icon)
- Tab 4: Deploy (rocket icon)
- Tab 5: Settings (gear icon)
