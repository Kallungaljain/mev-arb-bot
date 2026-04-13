// ─── Alchemy / Polygon Network Integration ────────────────────────────────────
// Uses Alchemy's Polygon RPC + REST APIs for gas, prices, and DEX data.

const POLYGON_TOKENS: Record<string, { address: string; decimals: number; coingeckoId: string }> = {
  WMATIC: { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18, coingeckoId: "matic-network" },
  WETH:   { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, coingeckoId: "ethereum" },
  USDC:   { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6,  coingeckoId: "usd-coin" },
  USDT:   { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6,  coingeckoId: "tether" },
  DAI:    { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, coingeckoId: "dai" },
  WBTC:   { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8,  coingeckoId: "wrapped-bitcoin" },
  LINK:   { address: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", decimals: 18, coingeckoId: "chainlink" },
  AAVE:   { address: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B", decimals: 18, coingeckoId: "aave" },
};

// QuickSwap V2 factory + SushiSwap factory on Polygon
const DEX_FACTORIES: Record<string, string> = {
  QuickSwap: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32",
  SushiSwap: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
};

// Uniswap V3 (QuickSwap V3 on Polygon uses same interface)
const UNISWAP_V3_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

// ─── RPC Helpers ──────────────────────────────────────────────────────────────

export function getAlchemyRpcUrl(apiKey: string): string {
  return `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ─── Gas Price ────────────────────────────────────────────────────────────────

export async function getGasPriceGwei(apiKey: string): Promise<number> {
  const rpcUrl = getAlchemyRpcUrl(apiKey);
  const hexGas = await rpcCall(rpcUrl, "eth_gasPrice", []) as string;
  const wei = parseInt(hexGas, 16);
  return wei / 1e9;
}

// ─── MATIC Price ──────────────────────────────────────────────────────────────

export async function getMaticPriceUsd(): Promise<number> {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await resp.json();
    return data["matic-network"]?.usd ?? 0;
  } catch {
    return 0;
  }
}

// ─── Token Prices (batch via CoinGecko) ───────────────────────────────────────

export async function getTokenPricesUsd(): Promise<Record<string, number>> {
  try {
    const ids = Object.values(POLYGON_TOKENS).map((t) => t.coingeckoId).join(",");
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await resp.json();
    const result: Record<string, number> = {};
    for (const [symbol, meta] of Object.entries(POLYGON_TOKENS)) {
      result[symbol] = data[meta.coingeckoId]?.usd ?? 0;
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Token Volatility (24h change %) ─────────────────────────────────────────

export async function getTokenVolatility(): Promise<Record<string, number>> {
  try {
    const ids = Object.values(POLYGON_TOKENS).map((t) => t.coingeckoId).join(",");
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await resp.json();
    const result: Record<string, number> = {};
    for (const [symbol, meta] of Object.entries(POLYGON_TOKENS)) {
      result[symbol] = Math.abs(data[meta.coingeckoId]?.usd_24h_change ?? 0);
    }
    return result;
  } catch {
    return {};
  }
}

// ─── DEX Pool Reserves (V2 style) ─────────────────────────────────────────────

// getReserves() selector: 0x0902f1ac
async function getPoolReserves(
  rpcUrl: string,
  pairAddress: string
): Promise<{ reserve0: bigint; reserve1: bigint } | null> {
  try {
    const result = await rpcCall(rpcUrl, "eth_call", [
      { to: pairAddress, data: "0x0902f1ac" },
      "latest",
    ]) as string;
    if (!result || result === "0x") return null;
    const reserve0 = BigInt("0x" + result.slice(2, 66));
    const reserve1 = BigInt("0x" + result.slice(66, 130));
    return { reserve0, reserve1 };
  } catch {
    return null;
  }
}

// getPair(tokenA, tokenB) selector: 0xe6a43905
async function getPairAddress(
  rpcUrl: string,
  factoryAddress: string,
  tokenA: string,
  tokenB: string
): Promise<string | null> {
  try {
    const ta = tokenA.toLowerCase().replace("0x", "").padStart(64, "0");
    const tb = tokenB.toLowerCase().replace("0x", "").padStart(64, "0");
    const data = "0xe6a43905" + ta + tb;
    const result = await rpcCall(rpcUrl, "eth_call", [
      { to: factoryAddress, data },
      "latest",
    ]) as string;
    if (!result || result === "0x" || result === "0x" + "0".repeat(64)) return null;
    return "0x" + result.slice(26);
  } catch {
    return null;
  }
}

// ─── Price from Reserves ──────────────────────────────────────────────────────

function priceFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  const r0 = Number(reserve0) / 10 ** decimals0;
  const r1 = Number(reserve1) / 10 ** decimals1;
  if (r0 === 0) return 0;
  return r1 / r0;
}

// ─── Slippage Estimate ────────────────────────────────────────────────────────

export function estimateSlippage(
  tradeAmountUsd: number,
  poolLiquidityUsd: number
): number {
  if (poolLiquidityUsd <= 0) return 100;
  // Constant product AMM: slippage ≈ tradeAmount / (2 * poolLiquidity) * 100
  return (tradeAmountUsd / (2 * poolLiquidityUsd)) * 100;
}

// ─── Gas Cost Estimate ────────────────────────────────────────────────────────

export function estimateGasCostUsd(
  gasGwei: number,
  maticPriceUsd: number,
  gasUnits = 400_000 // typical flash loan arb gas
): number {
  const gasMatic = (gasGwei * 1e9 * gasUnits) / 1e18;
  return gasMatic * maticPriceUsd;
}

// ─── Main Opportunity Scanner ─────────────────────────────────────────────────

export interface ScanResult {
  opportunities: import("./bot-store").ArbOpportunity[];
  gasGwei: number;
  maticPriceUsd: number;
}

const SCAN_PAIRS: Array<[string, string]> = [
  ["WMATIC", "USDC"],
  ["WMATIC", "USDT"],
  ["WMATIC", "WETH"],
  ["WETH", "USDC"],
  ["WETH", "USDT"],
  ["WBTC", "USDC"],
  ["LINK", "USDC"],
  ["AAVE", "USDC"],
  ["DAI", "USDC"],
  ["WMATIC", "DAI"],
];

export async function scanOpportunities(
  apiKey: string,
  settings: {
    minProfitUsd: number;
    maxSlippagePct: number;
    maxVolatilityPct: number;
    maxGasGwei: number;
    tradeAmountMatic: number;
  }
): Promise<ScanResult> {
  const rpcUrl = getAlchemyRpcUrl(apiKey);

  const [gasGwei, maticPrice, tokenPrices, volatility] = await Promise.all([
    getGasPriceGwei(apiKey),
    getMaticPriceUsd(),
    getTokenPricesUsd(),
    getTokenVolatility(),
  ]);

  const tradeAmountUsd = settings.tradeAmountMatic * maticPrice;
  const gasCostUsd = estimateGasCostUsd(gasGwei, maticPrice);

  const opportunities: import("./bot-store").ArbOpportunity[] = [];

  for (const [symbolA, symbolB] of SCAN_PAIRS) {
    const tokenA = POLYGON_TOKENS[symbolA];
    const tokenB = POLYGON_TOKENS[symbolB];
    if (!tokenA || !tokenB) continue;

    const dexNames = Object.keys(DEX_FACTORIES);
    const prices: Record<string, number> = {};
    const liquidities: Record<string, number> = {};

    for (const dexName of dexNames) {
      const factory = DEX_FACTORIES[dexName];
      try {
        const pairAddr = await getPairAddress(rpcUrl, factory, tokenA.address, tokenB.address);
        if (!pairAddr) continue;
        const reserves = await getPoolReserves(rpcUrl, pairAddr);
        if (!reserves) continue;
        const price = priceFromReserves(
          reserves.reserve0, reserves.reserve1,
          tokenA.decimals, tokenB.decimals
        );
        if (price <= 0) continue;
        prices[dexName] = price;
        // Estimate pool liquidity in USD
        const r0Usd = (Number(reserves.reserve0) / 10 ** tokenA.decimals) * (tokenPrices[symbolA] ?? 0);
        liquidities[dexName] = r0Usd * 2;
      } catch {
        // skip this dex/pair
      }
    }

    const dexList = Object.keys(prices);
    if (dexList.length < 2) continue;

    // Find best buy (lowest price) and best sell (highest price)
    const sorted = dexList.sort((a, b) => prices[a] - prices[b]);
    const buyDex = sorted[0];
    const sellDex = sorted[sorted.length - 1];
    const buyPrice = prices[buyDex];
    const sellPrice = prices[sellDex];
    const priceDiffPct = ((sellPrice - buyPrice) / buyPrice) * 100;

    if (priceDiffPct < 0.1) continue; // not worth scanning

    const poolLiquidityUsd = Math.min(liquidities[buyDex] ?? 0, liquidities[sellDex] ?? 0);
    const slippagePct = estimateSlippage(tradeAmountUsd, poolLiquidityUsd);
    const tokenVolatility = Math.max(volatility[symbolA] ?? 0, volatility[symbolB] ?? 0);

    // Net profit after slippage and gas
    const grossProfitPct = priceDiffPct - slippagePct * 2; // buy + sell slippage
    const estimatedProfitUsd = (grossProfitPct / 100) * tradeAmountUsd;
    const netProfitUsd = estimatedProfitUsd - gasCostUsd;

    // Safety checks
    let safe = true;
    let skipReason: string | undefined;

    if (gasGwei > settings.maxGasGwei) {
      safe = false; skipReason = `Gas too high: ${gasGwei.toFixed(0)} Gwei`;
    } else if (slippagePct > settings.maxSlippagePct) {
      safe = false; skipReason = `Slippage too high: ${slippagePct.toFixed(2)}%`;
    } else if (tokenVolatility > settings.maxVolatilityPct) {
      safe = false; skipReason = `Volatility too high: ${tokenVolatility.toFixed(1)}%`;
    } else if (netProfitUsd < settings.minProfitUsd) {
      safe = false; skipReason = `Net profit $${netProfitUsd.toFixed(2)} < min $${settings.minProfitUsd}`;
    }

    const confidence = Math.min(
      100,
      Math.max(0, Math.round(
        (priceDiffPct * 20) -
        (slippagePct * 10) -
        (tokenVolatility * 2) -
        (gasGwei > 100 ? 20 : 0)
      ))
    );

    opportunities.push({
      id: `${Date.now()}-${symbolA}-${symbolB}`,
      tokenIn: tokenA.address,
      tokenOut: tokenB.address,
      tokenInSymbol: symbolA,
      tokenOutSymbol: symbolB,
      buyDex,
      sellDex,
      buyPrice,
      sellPrice,
      priceDiffPct,
      estimatedProfitUsd,
      gasCostUsd,
      netProfitUsd,
      slippagePct,
      volatilityPct: tokenVolatility,
      poolLiquidityUsd,
      confidence,
      safe,
      skipReason,
      timestamp: Date.now(),
    });
  }

  // Sort: safe first, then by net profit descending
  opportunities.sort((a, b) => {
    if (a.safe && !b.safe) return -1;
    if (!a.safe && b.safe) return 1;
    return b.netProfitUsd - a.netProfitUsd;
  });

  return { opportunities, gasGwei, maticPriceUsd: maticPrice };
}
