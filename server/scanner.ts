/**
 * Elite MEV Scanner — VPS Service
 *
 * Replaces 15-second polling with real-time WebSocket event subscriptions.
 * Listens to Sync events from QuickSwap + SushiSwap pool contracts on Polygon.
 * Sync events fire every time a swap changes pool reserves — latency: 50–200ms.
 *
 * Architecture:
 *   Alchemy WSS → eth_subscribe(logs, Sync topic) → parse reserves →
 *   compute arb → risk filter → push to connected Android clients via WS
 */

import { ethers } from "ethers";
import { EventEmitter } from "events";
import type { ArbOpportunity } from "../lib/bot-store";

// ─── Constants ────────────────────────────────────────────────────────────────

// Uniswap V2 Sync event: emitted on every swap/mint/burn
// event Sync(uint112 reserve0, uint112 reserve1)
const SYNC_TOPIC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

// Uniswap V2 pair ABI (minimal — only what we need)
const PAIR_ABI = [
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
  "function allPairs(uint256) view returns (address pair)",
  "function allPairsLength() view returns (uint256)",
];

// Polygon token registry
export const TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
  "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270": { symbol: "WMATIC", decimals: 18, address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" },
  "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619": { symbol: "WETH",   decimals: 18, address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174": { symbol: "USDC",   decimals: 6,  address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F": { symbol: "USDT",   decimals: 6,  address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
  "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063": { symbol: "DAI",    decimals: 18, address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063" },
  "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6": { symbol: "WBTC",   decimals: 8,  address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6" },
  "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39": { symbol: "LINK",   decimals: 18, address: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39" },
  "0xD6DF932A45C0f255f85145f286eA0b292B21C90B": { symbol: "AAVE",   decimals: 18, address: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B" },
};

const DEX_FACTORIES: Record<string, string> = {
  QuickSwap: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32",
  SushiSwap: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
};

const SCAN_PAIRS: Array<[string, string]> = [
  ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // WMATIC/USDC
  ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"], // WMATIC/USDT
  ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"], // WMATIC/WETH
  ["0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // WETH/USDC
  ["0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"], // WETH/USDT
  ["0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // WBTC/USDC
  ["0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // LINK/USDC
  ["0xD6DF932A45C0f255f85145f286eA0b292B21C90B", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // AAVE/USDC
  ["0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], // DAI/USDC
  ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"], // WMATIC/DAI
];

// ─── Scanner State ─────────────────────────────────────────────────────────────

export interface ScannerState {
  running: boolean;
  scanCount: number;
  lastEventAt: number;
  gasGwei: number;
  maticPriceUsd: number;
  networkStatus: "connected" | "disconnected" | "error";
  opportunities: ArbOpportunity[];
  subscribedPools: number;
}

export interface ScannerSettings {
  alchemyApiKey: string;
  minProfitUsd: number;
  maxSlippagePct: number;
  maxVolatilityPct: number;
  maxGasGwei: number;
  tradeAmountMatic: number;
}

// ─── Pool Reserve Cache ────────────────────────────────────────────────────────

interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  token0: string;
  token1: string;
  dex: string;
  updatedAt: number;
}

// ─── Main Scanner Class ────────────────────────────────────────────────────────

export class EliteScanner extends EventEmitter {
  private wsProvider: ethers.WebSocketProvider | null = null;
  private httpProvider: ethers.JsonRpcProvider | null = null;
  private poolCache: Map<string, PoolReserves> = new Map();
  private pairAddresses: Map<string, string> = new Map(); // "dex:tokenA:tokenB" -> pairAddress
  private tokenPrices: Record<string, number> = {};
  private tokenVolatility: Record<string, number> = {};
  private gasRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private priceRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private settings: ScannerSettings;
  private state: ScannerState;

  constructor(settings: ScannerSettings) {
    super();
    this.settings = settings;
    this.state = {
      running: false,
      scanCount: 0,
      lastEventAt: 0,
      gasGwei: 0,
      maticPriceUsd: 0,
      networkStatus: "disconnected",
      opportunities: [],
      subscribedPools: 0,
    };
  }

  getState(): ScannerState {
    return { ...this.state };
  }

  updateSettings(settings: Partial<ScannerSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.state.running) return;
    if (!this.settings.alchemyApiKey) {
      this.emit("error", "No Alchemy API key configured");
      return;
    }

    this.state.running = true;
    this.emit("state", this.state);

    await this.connect();
  }

  // ── Stop ───────────────────────────────────────────────────────────────────

  stop(): void {
    this.state.running = false;
    this.cleanup();
    this.state.networkStatus = "disconnected";
    this.emit("state", this.state);
  }

  // ── Connect to Alchemy WebSocket ───────────────────────────────────────────

  private async connect(): Promise<void> {
    try {
      const wssUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${this.settings.alchemyApiKey}`;
      const httpUrl = `https://polygon-mainnet.g.alchemy.com/v2/${this.settings.alchemyApiKey}`;

      this.wsProvider = new ethers.WebSocketProvider(wssUrl);
      this.httpProvider = new ethers.JsonRpcProvider(httpUrl);

      // Wait for connection
      await this.wsProvider.getNetwork();
      this.state.networkStatus = "connected";
      this.emit("state", this.state);

      // Discover all pair addresses
      await this.discoverPairs();

      // Subscribe to Sync events on all known pools
      await this.subscribeToSyncEvents();

      // Refresh gas + prices every 30s (background)
      await this.refreshGasAndPrices();
      this.gasRefreshTimer = setInterval(() => this.refreshGasAndPrices(), 30_000);
      this.priceRefreshTimer = setInterval(() => this.refreshPrices(), 60_000);

      // Handle WS disconnect — cast to any to access native WebSocket events
      const ws = this.wsProvider.websocket as any;
      if (ws && typeof ws.addEventListener === "function") {
        ws.addEventListener("close", () => {
          if (this.state.running) {
            this.state.networkStatus = "error";
            this.emit("state", this.state);
            this.scheduleReconnect();
          }
        });
      } else if (ws && typeof ws.on === "function") {
        ws.on("close", () => {
          if (this.state.running) {
            this.state.networkStatus = "error";
            this.emit("state", this.state);
            this.scheduleReconnect();
          }
        });
      }

      console.log(`[scanner] Connected to Polygon via Alchemy WSS. Subscribed to ${this.state.subscribedPools} pools.`);
    } catch (err: any) {
      console.error("[scanner] Connection failed:", err.message);
      this.state.networkStatus = "error";
      this.emit("state", this.state);
      if (this.state.running) this.scheduleReconnect();
    }
  }

  // ── Discover Pair Addresses ────────────────────────────────────────────────

  private async discoverPairs(): Promise<void> {
    if (!this.httpProvider) return;

    for (const [dexName, factoryAddr] of Object.entries(DEX_FACTORIES)) {
      const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, this.httpProvider);

      for (const [tokenA, tokenB] of SCAN_PAIRS) {
        try {
          const pairAddr: string = await factory.getPair(tokenA, tokenB);
          if (!pairAddr || pairAddr === ethers.ZeroAddress) continue;

          const key = `${dexName}:${tokenA}:${tokenB}`;
          this.pairAddresses.set(key, pairAddr.toLowerCase());

          // Get initial reserves
          const pair = new ethers.Contract(pairAddr, PAIR_ABI, this.httpProvider);
          const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);

          // Fetch initial reserves via eth_call
          const iface = new ethers.Interface(["function getReserves() view returns (uint112, uint112, uint32)"]);
          const raw = await this.httpProvider.call({ to: pairAddr, data: iface.encodeFunctionData("getReserves") });
          const [r0, r1] = iface.decodeFunctionResult("getReserves", raw);

          this.poolCache.set(pairAddr.toLowerCase(), {
            reserve0: BigInt(r0.toString()),
            reserve1: BigInt(r1.toString()),
            token0: t0.toLowerCase(),
            token1: t1.toLowerCase(),
            dex: dexName,
            updatedAt: Date.now(),
          });
        } catch {
          // Pair may not exist on this DEX — skip silently
        }
      }
    }
  }

  // ── Subscribe to Sync Events ───────────────────────────────────────────────

  private async subscribeToSyncEvents(): Promise<void> {
    if (!this.wsProvider) return;

    const poolAddresses = Array.from(this.poolCache.keys());
    this.state.subscribedPools = poolAddresses.length;

    // Subscribe to Sync(uint112 reserve0, uint112 reserve1) on all pools
    // Using a single broad filter for efficiency
    const filter = {
      topics: [SYNC_TOPIC],
      address: poolAddresses,
    };

    this.wsProvider.on(filter, (log: ethers.Log) => {
      this.handleSyncEvent(log);
    });
  }

  // ── Handle Sync Event ──────────────────────────────────────────────────────

  private handleSyncEvent(log: ethers.Log): void {
    const pairAddr = log.address.toLowerCase();
    const cached = this.poolCache.get(pairAddr);
    if (!cached) return;

    // Decode Sync event: reserve0 (uint112) + reserve1 (uint112) packed in data
    try {
      const data = log.data;
      const reserve0 = BigInt("0x" + data.slice(2, 66));
      const reserve1 = BigInt("0x" + data.slice(66, 130));

      // Update cache
      this.poolCache.set(pairAddr, {
        ...cached,
        reserve0,
        reserve1,
        updatedAt: Date.now(),
      });

      this.state.lastEventAt = Date.now();
      this.state.scanCount++;

      // Recompute opportunities for this pair
      this.computeOpportunities();
    } catch (err) {
      // Malformed log — skip
    }
  }

  // ── Compute Arbitrage Opportunities ───────────────────────────────────────

  private computeOpportunities(): void {
    const opportunities: ArbOpportunity[] = [];
    const tradeAmountUsd = this.settings.tradeAmountMatic * this.state.maticPriceUsd;
    const gasCostUsd = this.estimateGasCostUsd();

    for (const [tokenA, tokenB] of SCAN_PAIRS) {
      const tokenAInfo = TOKENS[tokenA];
      const tokenBInfo = TOKENS[tokenB];
      if (!tokenAInfo || !tokenBInfo) continue;

      // Collect prices from all DEXes for this pair
      const dexPrices: Record<string, { price: number; liquidity: number; pairAddr: string }> = {};

      for (const dexName of Object.keys(DEX_FACTORIES)) {
        const key = `${dexName}:${tokenA}:${tokenB}`;
        const pairAddr = this.pairAddresses.get(key);
        if (!pairAddr) continue;

        const pool = this.poolCache.get(pairAddr);
        if (!pool) continue;

        // Determine which reserve maps to which token
        const isToken0A = pool.token0 === tokenA.toLowerCase();
        const r0 = isToken0A ? pool.reserve0 : pool.reserve1;
        const r1 = isToken0A ? pool.reserve1 : pool.reserve0;
        const dec0 = tokenAInfo.decimals;
        const dec1 = tokenBInfo.decimals;

        const r0f = Number(r0) / 10 ** dec0;
        const r1f = Number(r1) / 10 ** dec1;
        if (r0f === 0 || r1f === 0) continue;

        const price = r1f / r0f; // price of tokenA in terms of tokenB
        const tokenAPrice = this.tokenPrices[tokenAInfo.symbol] ?? 0;
        const liquidityUsd = r0f * tokenAPrice * 2;

        dexPrices[dexName] = { price, liquidity: liquidityUsd, pairAddr };
      }

      const dexList = Object.keys(dexPrices);
      if (dexList.length < 2) continue;

      // Find best buy (lowest price) and sell (highest price)
      const sorted = dexList.sort((a, b) => dexPrices[a].price - dexPrices[b].price);
      const buyDex = sorted[0];
      const sellDex = sorted[sorted.length - 1];
      const buyPrice = dexPrices[buyDex].price;
      const sellPrice = dexPrices[sellDex].price;
      const priceDiffPct = ((sellPrice - buyPrice) / buyPrice) * 100;

      if (priceDiffPct < 0.05) continue; // too small to bother

      const poolLiquidityUsd = Math.min(dexPrices[buyDex].liquidity, dexPrices[sellDex].liquidity);
      const slippagePct = tradeAmountUsd > 0 && poolLiquidityUsd > 0
        ? (tradeAmountUsd / (2 * poolLiquidityUsd)) * 100
        : 100;

      const volatilityA = this.tokenVolatility[tokenAInfo.symbol] ?? 0;
      const volatilityB = this.tokenVolatility[tokenBInfo.symbol] ?? 0;
      const volatilityPct = Math.max(volatilityA, volatilityB);

      const grossProfitPct = priceDiffPct - slippagePct * 2;
      const estimatedProfitUsd = (grossProfitPct / 100) * tradeAmountUsd;
      const netProfitUsd = estimatedProfitUsd - gasCostUsd;

      // Safety checks
      let safe = true;
      let skipReason: string | undefined;

      if (this.state.gasGwei > this.settings.maxGasGwei) {
        safe = false; skipReason = `Gas ${this.state.gasGwei.toFixed(0)} Gwei > max ${this.settings.maxGasGwei}`;
      } else if (slippagePct > this.settings.maxSlippagePct) {
        safe = false; skipReason = `Slippage ${slippagePct.toFixed(2)}% > max ${this.settings.maxSlippagePct}%`;
      } else if (volatilityPct > this.settings.maxVolatilityPct) {
        safe = false; skipReason = `Volatility ${volatilityPct.toFixed(1)}% > max ${this.settings.maxVolatilityPct}%`;
      } else if (netProfitUsd < this.settings.minProfitUsd) {
        safe = false; skipReason = `Net profit $${netProfitUsd.toFixed(3)} < min $${this.settings.minProfitUsd}`;
      }

      const confidence = Math.min(100, Math.max(0, Math.round(
        priceDiffPct * 20 - slippagePct * 10 - volatilityPct * 2 - (this.state.gasGwei > 100 ? 20 : 0)
      )));

      opportunities.push({
        id: `${Date.now()}-${tokenAInfo.symbol}-${tokenBInfo.symbol}`,
        tokenIn: tokenA,
        tokenOut: tokenB,
        tokenInSymbol: tokenAInfo.symbol,
        tokenOutSymbol: tokenBInfo.symbol,
        buyDex,
        sellDex,
        buyPrice,
        sellPrice,
        priceDiffPct,
        estimatedProfitUsd,
        gasCostUsd,
        netProfitUsd,
        slippagePct,
        volatilityPct,
        poolLiquidityUsd,
        confidence,
        safe,
        skipReason,
        timestamp: Date.now(),
      });
    }

    // Sort: safe first, then by net profit
    opportunities.sort((a, b) => {
      if (a.safe && !b.safe) return -1;
      if (!a.safe && b.safe) return 1;
      return b.netProfitUsd - a.netProfitUsd;
    });

    this.state.opportunities = opportunities;
    this.emit("opportunities", opportunities);
    this.emit("state", this.state);
  }

  // ── Gas & Price Refresh ────────────────────────────────────────────────────

  private async refreshGasAndPrices(): Promise<void> {
    await Promise.all([this.refreshGas(), this.refreshPrices()]);
  }

  private async refreshGas(): Promise<void> {
    if (!this.httpProvider) return;
    try {
      const feeData = await this.httpProvider.getFeeData();
      if (feeData.gasPrice) {
        this.state.gasGwei = Number(feeData.gasPrice) / 1e9;
        this.emit("state", this.state);
      }
    } catch { /* ignore */ }
  }

  private async refreshPrices(): Promise<void> {
    try {
      const ids = "matic-network,ethereum,usd-coin,tether,dai,wrapped-bitcoin,chainlink,aave";
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await resp.json() as Record<string, { usd: number; usd_24h_change?: number }>;

      const map: Record<string, string> = {
        "matic-network": "WMATIC",
        "ethereum": "WETH",
        "usd-coin": "USDC",
        "tether": "USDT",
        "dai": "DAI",
        "wrapped-bitcoin": "WBTC",
        "chainlink": "LINK",
        "aave": "AAVE",
      };

      for (const [cgId, symbol] of Object.entries(map)) {
        if (data[cgId]) {
          this.tokenPrices[symbol] = data[cgId].usd;
          this.tokenVolatility[symbol] = Math.abs(data[cgId].usd_24h_change ?? 0);
        }
      }

      this.state.maticPriceUsd = this.tokenPrices["WMATIC"] ?? 0;
      this.emit("state", this.state);
    } catch { /* ignore */ }
  }

  // ── Gas Cost Estimate ──────────────────────────────────────────────────────

  private estimateGasCostUsd(gasUnits = 400_000): number {
    return (this.state.gasGwei * 1e9 * gasUnits / 1e18) * this.state.maticPriceUsd;
  }

  // ── Reconnect Logic ────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log("[scanner] Reconnecting in 5s...");
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.cleanup();
      if (this.state.running) await this.connect();
    }, 5000);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private cleanup(): void {
    if (this.gasRefreshTimer) { clearInterval(this.gasRefreshTimer); this.gasRefreshTimer = null; }
    if (this.priceRefreshTimer) { clearInterval(this.priceRefreshTimer); this.priceRefreshTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.wsProvider) {
      try { this.wsProvider.destroy(); } catch { /* ignore */ }
      this.wsProvider = null;
    }
    this.httpProvider = null;
  }
}
