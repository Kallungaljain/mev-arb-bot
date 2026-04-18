# System Reanalysis: Critical Failures & Fixes

## Executive Summary

The current system has **fundamental architectural flaws** preventing it from functioning as an arbitrage engine:

1. **HTTP 404 errors** — tRPC routes are not properly exposed; the app cannot call `/api/trpc/bot.start`
2. **No real price discovery** — scanner.ts has WebSocket code but never actually subscribes to events
3. **Simulated opportunities** — bot-context.ts generates fake trades instead of detecting real ones
4. **No on-chain execution** — trades are never signed or submitted to the contract
5. **Broken Alchemy integration** — API key validation fails, WebSocket connection never established

---

## Root Cause Analysis

### Issue 1: HTTP 404 on tRPC Endpoints

**Symptom:** App shows "Connection Error HTTP 404" when trying to start bot

**Root Cause:** The tRPC middleware in `server/_core/index.ts` registers routes at `/api/trpc` but the app tries to call them via the Keeper API client which expects REST endpoints.

**Current Code Path:**
```
app → keeper-api.ts → http://localhost:3001/api/opportunities
server → server/_core/index.ts → app.use("/api/trpc", ...)
```

**Problem:** The keeper-api client expects REST endpoints like `/api/opportunities`, but the server only exposes tRPC endpoints at `/api/trpc/bot.opportunities` which require special tRPC client handling.

**Fix:** Create proper REST API endpoints that wrap the tRPC procedures.

---

### Issue 2: Scanner Never Actually Subscribes to Events

**Symptom:** Dashboard shows "0 scans" even after starting bot

**Root Cause:** `server/scanner.ts` has the WebSocket code structure but never actually calls `wsProvider.on("logs", ...)` to listen for Sync events.

**Current Code (lines 163-214):**
```typescript
async connect() {
  const wssUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${this.settings.alchemyApiKey}`;
  this.wsProvider = new ethers.WebSocketProvider(wssUrl);
  await this.wsProvider.getNetwork();  // ← Just checks connection
  await this.discoverPairs();           // ← Finds pair addresses
  await this.subscribeToSyncEvents();   // ← Should subscribe but doesn't
}
```

**Missing Implementation:** The `subscribeToSyncEvents()` method is never defined or called with actual event listeners.

**Fix:** Implement proper WebSocket event subscription with `wsProvider.on("logs", callback)`.

---

### Issue 3: Opportunities Are Simulated, Not Real

**Symptom:** Opportunities screen shows fake data that never changes

**Root Cause:** `lib/bot-context.tsx` generates random opportunities every 500ms instead of waiting for real Sync events.

**Current Code (lines 150-200):**
```typescript
const opportunities = [
  {
    pair_name: "WMATIC/USDC",
    buy_dex: "QuickSwap",
    sell_dex: "SushiSwap",
    spread_pct: Math.random() * 2,  // ← FAKE
    ...
  }
];
```

**Fix:** Remove simulation; wait for real opportunities from scanner.

---

### Issue 4: No On-Chain Trade Execution

**Symptom:** "Executed" trades never appear in history; no transactions on PolygonScan

**Root Cause:** The trade execution code is stubbed out in `keeper/src/activator.ts` and never actually calls the smart contract.

**Current Code:**
```typescript
async executeArb(opp: Opportunity) {
  // Stub: never actually signs or submits
  return { txHash: "0x" + Math.random().toString(16) };
}
```

**Fix:** Implement real transaction signing with ethers.js and submission to EliteAntArb contract.

---

### Issue 5: Alchemy API Key Validation Fails

**Symptom:** "Set your Alchemy API key in Settings to start scanning" message persists

**Root Cause:** The validation function in `lib/alchemy.ts` tries to call `eth_chainId` but the Alchemy API key is invalid or the endpoint is wrong.

**Current Code:**
```typescript
export async function validateAlchemyKey(key: string): Promise<boolean> {
  try {
    const response = await fetch(`https://polygon-mainnet.g.alchemy.com/v2/${key}`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    });
    return response.ok;  // ← Returns false if 404 or 401
  } catch {
    return false;
  }
}
```

**Fix:** Ensure Alchemy API key is correct and the endpoint is reachable.

---

## System Architecture Issues

### Current Architecture (Broken)

```
Android App
  ├─ Settings: Enter Alchemy API key
  ├─ Dashboard: Calls /api/opportunities (HTTP 404)
  ├─ Opportunities: Shows fake simulated data
  └─ History: Empty (no trades executed)

Server (Node.js)
  ├─ tRPC Router: /api/trpc/bot.* (not exposed as REST)
  ├─ Scanner: WebSocket code exists but never subscribes
  ├─ Keeper: Never receives opportunities
  └─ Activator: Never executes trades

Smart Contract
  └─ EliteAntArb: Deployed but never called
```

### Required Architecture (Production)

```
Android App (Queen)
  ├─ Settings: Enter Alchemy API key + Keeper URL
  ├─ Dashboard: Calls REST /api/bot/status
  ├─ Opportunities: Real-time WebSocket feed
  └─ History: Actual executed trades from blockchain

VPS (Scanner + Keeper)
  ├─ Rust Scanner: WebSocket → Sync events → ZeroMQ PUSH
  ├─ Rust Keeper: ZeroMQ PULL → Risk engine → HTTP to Queen
  └─ REST API: /api/bot/status, /api/bot/opportunities, /api/bot/execute

Smart Contract (Polygon)
  └─ EliteAntArb: Receives flash loan calls, executes swaps, returns profit
```

---

## Fix Priority

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 🔴 CRITICAL | No REST API endpoints | App cannot communicate with server | 1 hour |
| 🔴 CRITICAL | Scanner never subscribes to events | No opportunities detected | 2 hours |
| 🔴 CRITICAL | No trade execution | No actual profits | 3 hours |
| 🟠 HIGH | Alchemy key validation broken | Cannot start bot | 30 min |
| 🟠 HIGH | Simulated opportunities | Misleading UI | 1 hour |
| 🟡 MEDIUM | No real price discovery | Cannot calculate accurate spreads | 2 hours |

---

## Implementation Plan

### Phase 1: Fix REST API (1 hour)

Create proper REST endpoints that wrap tRPC:

```typescript
// server/_core/index.ts
app.get("/api/bot/status", async (req, res) => {
  const state = scanner.getState();
  res.json(state);
});

app.get("/api/bot/opportunities", async (req, res) => {
  const opps = scanner.getState().opportunities;
  res.json(opps);
});

app.post("/api/bot/start", async (req, res) => {
  const { alchemyApiKey } = req.body;
  await scanner.start();
  res.json({ ok: true });
});
```

### Phase 2: Implement Real WebSocket Subscriptions (2 hours)

Fix `server/scanner.ts` to actually listen to Sync events:

```typescript
private async subscribeToSyncEvents(): Promise<void> {
  if (!this.wsProvider) return;

  const filter = {
    topics: [SYNC_TOPIC],
    address: Array.from(this.poolCache.keys()),
  };

  this.wsProvider.on(filter, (log) => {
    this.onSyncEvent(log);
  });
}

private onSyncEvent(log: ethers.Log) {
  // Decode Sync event: reserve0, reserve1
  // Update pool cache
  // Calculate arbitrage opportunities
  // Emit to connected clients
}
```

### Phase 3: Implement Real Trade Execution (3 hours)

Wire up `keeper/src/activator.ts` to sign and submit transactions:

```typescript
async executeArb(opp: Opportunity) {
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(ELITE_ANT_ARB, ABI, signer);

  const tx = await contract.executeArb(
    opp.loanToken,
    opp.loanAmount,
    opp.buyDex,
    opp.sellDex,
    opp.minProfit
  );

  const receipt = await tx.wait();
  return { txHash: receipt.transactionHash };
}
```

### Phase 4: Fix Alchemy Integration (30 min)

Validate and test Alchemy API key:

```typescript
export async function validateAlchemyKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(`https://polygon-mainnet.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    if (data.error) {
      return { valid: false, error: data.error.message };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
```

### Phase 5: Implement Real Price Discovery (2 hours)

Calculate actual prices from pool reserves:

```typescript
function calculatePrice(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  const scaled0 = Number(reserve0) / Math.pow(10, decimals0);
  const scaled1 = Number(reserve1) / Math.pow(10, decimals1);
  return scaled1 / scaled0;  // price of token0 in token1
}

function detectArbitrage(
  quickswapPrice: number,
  sushiswapPrice: number,
  minSpread: number
): { spread: number; profitable: boolean } {
  const spread = Math.abs(quickswapPrice - sushiswapPrice) / quickswapPrice;
  return {
    spread: spread * 100,
    profitable: spread > minSpread,
  };
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// test/price-discovery.test.ts
describe("Price Discovery", () => {
  it("calculates correct price from reserves", () => {
    const price = calculatePrice(
      BigInt("1000000000000000000"),  // 1e18
      BigInt("2000000000000000000"),  // 2e18
      18,
      18
    );
    expect(price).toBe(2);
  });

  it("detects arbitrage opportunity", () => {
    const result = detectArbitrage(1.0, 1.05, 0.01);
    expect(result.profitable).toBe(true);
    expect(result.spread).toBeGreaterThan(4);
  });
});
```

### Integration Tests

```typescript
// test/end-to-end.test.ts
describe("End-to-End", () => {
  it("detects and executes arbitrage", async () => {
    // 1. Start scanner
    await scanner.start();

    // 2. Wait for Sync events
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Verify opportunities detected
    const opps = scanner.getState().opportunities;
    expect(opps.length).toBeGreaterThan(0);

    // 4. Execute first opportunity
    const tx = await keeper.executeArb(opps[0]);
    expect(tx.txHash).toMatch(/^0x[a-f0-9]{64}$/);

    // 5. Verify transaction on blockchain
    const receipt = await provider.getTransactionReceipt(tx.txHash);
    expect(receipt.status).toBe(1);  // Success
  });
});
```

---

## Deployment Checklist

- [ ] Fix REST API endpoints
- [ ] Implement WebSocket event subscriptions
- [ ] Implement trade execution
- [ ] Fix Alchemy API key validation
- [ ] Implement real price discovery
- [ ] Write and pass unit tests
- [ ] Write and pass integration tests
- [ ] Deploy to VPS
- [ ] Test with real Polygon mainnet
- [ ] Monitor logs for errors
- [ ] Verify trades execute and profit

---

## Estimated Timeline

| Phase | Task | Effort | Status |
|-------|------|--------|--------|
| 1 | Fix REST API | 1 hour | TODO |
| 2 | WebSocket subscriptions | 2 hours | TODO |
| 3 | Trade execution | 3 hours | TODO |
| 4 | Alchemy validation | 30 min | TODO |
| 5 | Price discovery | 2 hours | TODO |
| 6 | Testing | 3 hours | TODO |
| 7 | Deployment | 1 hour | TODO |
| **Total** | | **12.5 hours** | **0%** |

---

## Next Steps

1. **Immediately:** Fix REST API endpoints so app can communicate with server
2. **Next:** Implement real WebSocket subscriptions to Polygon pools
3. **Then:** Wire up trade execution to smart contract
4. **Finally:** Test end-to-end with real Polygon data

This will transform the system from a non-functional prototype into a real, working arbitrage engine.
