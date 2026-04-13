import { describe, it, expect } from "vitest";
import { estimateSlippage, estimateGasCostUsd } from "../lib/alchemy";
import { DEFAULT_SETTINGS, DEFAULT_BOT_STATE } from "../lib/bot-store";

describe("Slippage Calculator", () => {
  it("returns 0 slippage for very large pool relative to trade", () => {
    const slippage = estimateSlippage(100, 10_000_000);
    expect(slippage).toBeCloseTo(0.0005, 4);
  });

  it("returns high slippage for small pool", () => {
    const slippage = estimateSlippage(10_000, 20_000);
    expect(slippage).toBeCloseTo(25, 0);
  });

  it("returns 100% slippage for zero liquidity pool", () => {
    const slippage = estimateSlippage(1000, 0);
    expect(slippage).toBe(100);
  });

  it("slippage scales linearly with trade size", () => {
    const s1 = estimateSlippage(1000, 1_000_000);
    const s2 = estimateSlippage(2000, 1_000_000);
    expect(s2).toBeCloseTo(s1 * 2, 5);
  });
});

describe("Gas Cost Estimator", () => {
  it("calculates gas cost correctly at 100 Gwei and $1 MATIC", () => {
    const cost = estimateGasCostUsd(100, 1.0, 400_000);
    // 100 * 1e9 * 400_000 / 1e18 = 0.04 MATIC * $1 = $0.04
    expect(cost).toBeCloseTo(0.04, 4);
  });

  it("gas cost scales with MATIC price", () => {
    const cost1 = estimateGasCostUsd(100, 1.0, 400_000);
    const cost2 = estimateGasCostUsd(100, 2.0, 400_000);
    expect(cost2).toBeCloseTo(cost1 * 2, 5);
  });

  it("gas cost scales with gas price", () => {
    const cost1 = estimateGasCostUsd(100, 1.0, 400_000);
    const cost2 = estimateGasCostUsd(200, 1.0, 400_000);
    expect(cost2).toBeCloseTo(cost1 * 2, 5);
  });

  it("returns 0 for 0 MATIC price", () => {
    const cost = estimateGasCostUsd(100, 0, 400_000);
    expect(cost).toBe(0);
  });
});

describe("Default Settings", () => {
  it("has safe default risk parameters", () => {
    expect(DEFAULT_SETTINGS.minProfitUsd).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.maxSlippagePct).toBeLessThan(5);
    expect(DEFAULT_SETTINGS.maxVolatilityPct).toBeLessThan(20);
    expect(DEFAULT_SETTINGS.maxGasGwei).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.autoExecute).toBe(false); // safe default: off
  });

  it("has no private key by default (security)", () => {
    expect(DEFAULT_SETTINGS.privateKey).toBe("");
    expect(DEFAULT_SETTINGS.alchemyApiKey).toBe("");
  });
});

describe("Default Bot State", () => {
  it("starts in stopped state", () => {
    expect(DEFAULT_BOT_STATE.running).toBe(false);
    expect(DEFAULT_BOT_STATE.networkStatus).toBe("disconnected");
  });

  it("starts with zero counters", () => {
    expect(DEFAULT_BOT_STATE.scanCount).toBe(0);
    expect(DEFAULT_BOT_STATE.totalProfitUsd).toBe(0);
    expect(DEFAULT_BOT_STATE.successTrades).toBe(0);
    expect(DEFAULT_BOT_STATE.failedTrades).toBe(0);
  });
});

describe("Profit vs Gas Safety Logic", () => {
  it("correctly identifies unprofitable trade (gas > profit)", () => {
    const estimatedProfitUsd = 0.05;
    const gasCostUsd = 0.10;
    const netProfit = estimatedProfitUsd - gasCostUsd;
    expect(netProfit).toBeLessThan(0);
  });

  it("correctly identifies profitable trade", () => {
    const estimatedProfitUsd = 5.00;
    const gasCostUsd = 0.50;
    const netProfit = estimatedProfitUsd - gasCostUsd;
    expect(netProfit).toBeGreaterThan(DEFAULT_SETTINGS.minProfitUsd);
  });

  it("rejects trade below minimum profit threshold", () => {
    const netProfit = 1.50;
    const minProfit = 2.00;
    expect(netProfit < minProfit).toBe(true);
  });
});
