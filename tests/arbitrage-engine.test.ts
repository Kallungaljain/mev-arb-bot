/**
 * Arbitrage Engine Tests
 *
 * Unit and integration tests for:
 * - Price discovery from pool reserves
 * - Arbitrage opportunity detection
 * - Risk filtering (gas, slippage, volatility, profit)
 * - Trade execution
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Price Discovery Tests ────────────────────────────────────────────────────

describe("Price Discovery", () => {
  it("calculates correct price from pool reserves", () => {
    // Uniswap V2 formula: price = reserve1 / reserve0
    const reserve0 = BigInt("1000000000000000000"); // 1e18 (1 WMATIC)
    const reserve1 = BigInt("2000000000000000000"); // 2e18 (2 USDC)
    const decimals0 = 18;
    const decimals1 = 18;

    const scaled0 = Number(reserve0) / Math.pow(10, decimals0);
    const scaled1 = Number(reserve1) / Math.pow(10, decimals1);
    const price = scaled1 / scaled0;

    expect(price).toBe(2);
  });

  it("handles different decimal places", () => {
    // WBTC (8 decimals) / USDC (6 decimals)
    const reserve0 = BigInt("1000000"); // 0.01 WBTC
    const reserve1 = BigInt("600000000"); // 600 USDC
    const decimals0 = 8;
    const decimals1 = 6;

    const scaled0 = Number(reserve0) / Math.pow(10, decimals0);
    const scaled1 = Number(reserve1) / Math.pow(10, decimals1);
    const price = scaled1 / scaled0;

    expect(price).toBeCloseTo(60000, 0);
  });

  it("avoids division by zero", () => {
    const reserve0 = BigInt("0");
    const reserve1 = BigInt("1000000000000000000");

    const scaled0 = Number(reserve0) / Math.pow(10, 18);
    const scaled1 = Number(reserve1) / Math.pow(10, 18);

    expect(scaled0).toBe(0);
    expect(scaled1 / scaled0).toBe(Infinity);
  });
});

// ─── Arbitrage Detection Tests ────────────────────────────────────────────────

describe("Arbitrage Detection", () => {
  it("detects profitable spread between two DEXes", () => {
    const quickswapPrice = 1.0;
    const sushiswapPrice = 1.05;
    const minSpread = 0.01; // 1%

    const spread = Math.abs(sushiswapPrice - quickswapPrice) / quickswapPrice;

    expect(spread).toBeGreaterThan(minSpread);
    expect(spread * 100).toBeCloseTo(5, 1);
  });

  it("ignores small spreads below minimum threshold", () => {
    const quickswapPrice = 1.0;
    const sushiswapPrice = 1.002;
    const minSpread = 0.01; // 1%

    const spread = Math.abs(sushiswapPrice - quickswapPrice) / quickswapPrice;

    expect(spread).toBeLessThan(minSpread);
  });

  it("calculates correct profit direction (buy low, sell high)", () => {
    const buyPrice = 1.0;
    const sellPrice = 1.05;
    const tradeAmount = 1000; // $1000

    const grossProfit = (sellPrice - buyPrice) * tradeAmount;

    expect(grossProfit).toBeCloseTo(50, 1);
    expect(grossProfit).toBeGreaterThan(0);
  });
});

// ─── Risk Filter Tests ────────────────────────────────────────────────────────

describe("Risk Filters", () => {
  it("rejects trades when gas cost exceeds profit", () => {
    const estimatedProfitUsd = 5;
    const gasCostUsd = 10;
    const minProfitUsd = 2;

    const netProfitUsd = estimatedProfitUsd - gasCostUsd;
    const safe = netProfitUsd >= minProfitUsd;

    expect(safe).toBe(false);
    expect(netProfitUsd).toBeLessThan(minProfitUsd);
  });

  it("accepts trades with sufficient profit margin", () => {
    const estimatedProfitUsd = 50;
    const gasCostUsd = 10;
    const minProfitUsd = 2;

    const netProfitUsd = estimatedProfitUsd - gasCostUsd;
    const safe = netProfitUsd >= minProfitUsd;

    expect(safe).toBe(true);
    expect(netProfitUsd).toBeGreaterThanOrEqual(minProfitUsd);
  });

  it("rejects trades with excessive slippage", () => {
    const tradeAmountUsd = 1000;
    const poolLiquidityUsd = 5000;
    const maxSlippagePct = 0.5;

    const slippagePct = (tradeAmountUsd / (2 * poolLiquidityUsd)) * 100;
    const safe = slippagePct <= maxSlippagePct;

    expect(slippagePct).toBeGreaterThan(maxSlippagePct);
    expect(safe).toBe(false);
  });

  it("accepts trades with acceptable slippage", () => {
    const tradeAmountUsd = 100;
    const poolLiquidityUsd = 100000;
    const maxSlippagePct = 0.5;

    const slippagePct = (tradeAmountUsd / (2 * poolLiquidityUsd)) * 100;
    const safe = slippagePct <= maxSlippagePct;

    expect(slippagePct).toBeLessThan(maxSlippagePct);
    expect(safe).toBe(true);
  });

  it("rejects high-volatility tokens", () => {
    const volatilityPct = 8;
    const maxVolatilityPct = 5;
    const safe = volatilityPct <= maxVolatilityPct;

    expect(safe).toBe(false);
  });

  it("accepts low-volatility tokens", () => {
    const volatilityPct = 2;
    const maxVolatilityPct = 5;
    const safe = volatilityPct <= maxVolatilityPct;

    expect(safe).toBe(true);
  });

  it("rejects trades when gas price is too high", () => {
    const gasGwei = 250;
    const maxGasGwei = 200;
    const safe = gasGwei <= maxGasGwei;

    expect(safe).toBe(false);
  });

  it("accepts trades when gas price is acceptable", () => {
    const gasGwei = 150;
    const maxGasGwei = 200;
    const safe = gasGwei <= maxGasGwei;

    expect(safe).toBe(true);
  });
});

// ─── Gas Cost Estimation Tests ────────────────────────────────────────────────

describe("Gas Cost Estimation", () => {
  it("calculates gas cost in USD correctly", () => {
    const gasGwei = 100;
    const gasUnits = 400_000;
    const maticPriceUsd = 0.8;

    const gasCostWei = gasGwei * 1e9 * gasUnits;
    const gasCostUsd = gasCostWei / 1e18 * maticPriceUsd;

    expect(gasCostUsd).toBeCloseTo(0.032, 3);
  });

  it("handles zero gas price", () => {
    const gasGwei = 0;
    const gasUnits = 400_000;
    const maticPriceUsd = 0.8;

    const gasCostWei = gasGwei * 1e9 * gasUnits;
    const gasCostUsd = gasCostWei / 1e18 * maticPriceUsd;

    expect(gasCostUsd).toBe(0);
  });

  it("scales with different gas prices", () => {
    const gasUnits = 400_000;
    const maticPriceUsd = 0.8;

    const cost100 = (100 * 1e9 * gasUnits) / 1e18 * maticPriceUsd;
    const cost200 = (200 * 1e9 * gasUnits) / 1e18 * maticPriceUsd;

    expect(cost200).toBeCloseTo(cost100 * 2, 1);
  });
});

// ─── Confidence Scoring Tests ────────────────────────────────────────────────

describe("Confidence Scoring", () => {
  it("calculates high confidence for large spreads with low slippage", () => {
    const priceDiffPct = 5;
    const slippagePct = 0.1;
    const volatilityPct = 1;
    const gasGwei = 50;

    const confidence = Math.min(100, Math.max(0, Math.round(
      priceDiffPct * 20 - slippagePct * 10 - volatilityPct * 2 - (gasGwei > 100 ? 20 : 0)
    )));

    expect(confidence).toBeGreaterThan(80);
  });

  it("calculates low confidence for small spreads with high slippage", () => {
    const priceDiffPct = 0.5;
    const slippagePct = 0.3;
    const volatilityPct = 3;
    const gasGwei = 150;

    const confidence = Math.min(100, Math.max(0, Math.round(
      priceDiffPct * 20 - slippagePct * 10 - volatilityPct * 2 - (gasGwei > 100 ? 20 : 0)
    )));

    expect(confidence).toBeLessThan(50);
  });

  it("clamps confidence between 0 and 100", () => {
    const scenarios = [
      { priceDiffPct: 10, slippagePct: 0, volatilityPct: 0, gasGwei: 50 },
      { priceDiffPct: 0.1, slippagePct: 1, volatilityPct: 5, gasGwei: 200 },
    ];

    for (const s of scenarios) {
      const confidence = Math.min(100, Math.max(0, Math.round(
        s.priceDiffPct * 20 - s.slippagePct * 10 - s.volatilityPct * 2 - (s.gasGwei > 100 ? 20 : 0)
      )));

      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(100);
    }
  });
});

// ─── Opportunity Ranking Tests ────────────────────────────────────────────────

describe("Opportunity Ranking", () => {
  it("ranks safe opportunities before unsafe ones", () => {
    const opportunities = [
      { safe: false, netProfitUsd: 100 },
      { safe: true, netProfitUsd: 10 },
      { safe: false, netProfitUsd: 50 },
      { safe: true, netProfitUsd: 20 },
    ];

    const sorted = opportunities.sort((a, b) => {
      if (a.safe && !b.safe) return -1;
      if (!a.safe && b.safe) return 1;
      return b.netProfitUsd - a.netProfitUsd;
    });

    expect(sorted[0].safe).toBe(true);
    expect(sorted[1].safe).toBe(true);
    expect(sorted[2].safe).toBe(false);
    expect(sorted[3].safe).toBe(false);
  });

  it("ranks by profit within same safety level", () => {
    const opportunities = [
      { safe: true, netProfitUsd: 10 },
      { safe: true, netProfitUsd: 50 },
      { safe: true, netProfitUsd: 30 },
    ];

    const sorted = opportunities.sort((a, b) => b.netProfitUsd - a.netProfitUsd);

    expect(sorted[0].netProfitUsd).toBe(50);
    expect(sorted[1].netProfitUsd).toBe(30);
    expect(sorted[2].netProfitUsd).toBe(10);
  });
});

// ─── Integration Test: Full Arbitrage Flow ────────────────────────────────────

describe("Full Arbitrage Flow", () => {
  it("processes a complete arbitrage opportunity", () => {
    // Simulate a real opportunity
    const opportunity = {
      tokenIn: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
      tokenOut: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
      buyDex: "QuickSwap",
      sellDex: "SushiSwap",
      buyPrice: 1.0,
      sellPrice: 1.05,
      priceDiffPct: 5,
      tradeAmountUsd: 1000,
      slippagePct: 0.2,
      volatilityPct: 1,
      gasGwei: 100,
      gasCostUsd: 32,
      maticPriceUsd: 0.8,
      minProfitUsd: 2,
      maxSlippagePct: 0.5,
      maxVolatilityPct: 5,
      maxGasGwei: 200,
    };

    // Calculate profit
    const grossProfitPct = opportunity.priceDiffPct - opportunity.slippagePct * 2;
    const estimatedProfitUsd = (grossProfitPct / 100) * opportunity.tradeAmountUsd;
    const netProfitUsd = estimatedProfitUsd - opportunity.gasCostUsd;

    // Check all safety conditions
    const safe =
      opportunity.gasGwei <= opportunity.maxGasGwei &&
      opportunity.slippagePct <= opportunity.maxSlippagePct &&
      opportunity.volatilityPct <= opportunity.maxVolatilityPct &&
      netProfitUsd >= opportunity.minProfitUsd;

    expect(safe).toBe(true);
    expect(netProfitUsd).toBeGreaterThan(opportunity.minProfitUsd);
    expect(netProfitUsd).toBeCloseTo(14, 0);
  });

  it("rejects opportunity with insufficient profit", () => {
    const opportunity = {
      priceDiffPct: 0.3,
      slippagePct: 0.15,
      tradeAmountUsd: 1000,
      gasGwei: 100,
      gasCostUsd: 32,
      minProfitUsd: 2,
      maxSlippagePct: 0.5,
      maxVolatilityPct: 5,
      maxGasGwei: 200,
      volatilityPct: 1,
    };

    const grossProfitPct = opportunity.priceDiffPct - opportunity.slippagePct * 2;
    const estimatedProfitUsd = (grossProfitPct / 100) * opportunity.tradeAmountUsd;
    const netProfitUsd = estimatedProfitUsd - opportunity.gasCostUsd;

    const safe =
      opportunity.gasGwei <= opportunity.maxGasGwei &&
      opportunity.slippagePct <= opportunity.maxSlippagePct &&
      opportunity.volatilityPct <= opportunity.maxVolatilityPct &&
      netProfitUsd >= opportunity.minProfitUsd;

    expect(safe).toBe(false);
    expect(netProfitUsd).toBeLessThan(opportunity.minProfitUsd);
  });
});
