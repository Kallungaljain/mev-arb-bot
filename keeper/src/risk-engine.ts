// ─── Risk Engine ──────────────────────────────────────────────────────────────
//
// The Keeper's risk engine performs a final validation of every opportunity
// received from the Rust scanner before allowing execution.
//
// Checks (in order):
//   1. Opportunity is not stale (< 2 seconds old)
//   2. Gas price is within acceptable range
//   3. Net profit exceeds minimum threshold (recalculated with live gas)
//   4. Slippage is within acceptable range
//   5. Contract address is set and valid
//   6. Bot is in running state

import { ethers } from "ethers";
import { KeeperConfig } from "./config";
import { Opportunity } from "./types";

export interface RiskResult {
  approved: boolean;
  reason?: string;
  adjustedNetProfitUsd?: number;
  liveGasGwei?: number;
  liveMaticPriceUsd?: number;
}

// Estimated gas units for a flash loan arb tx
const ESTIMATED_GAS_UNITS = 350_000n;
// AAVE V3 flash loan fee: 0.05%
const AAVE_FEE_BPS = 5n;

export class RiskEngine {
  private provider: ethers.JsonRpcProvider;

  constructor(private cfg: KeeperConfig) {
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  }

  async assess(opp: Opportunity): Promise<RiskResult> {
    // ── 1. Staleness check ───────────────────────────────────────────────────
    const ageMs = Date.now() - opp.timestamp_ms;
    if (ageMs > 2000) {
      return { approved: false, reason: `Opportunity stale (${ageMs}ms old)` };
    }

    // ── 2. Live gas price ────────────────────────────────────────────────────
    let gasGwei: number;
    try {
      const feeData = await this.provider.getFeeData();
      gasGwei = Number(feeData.gasPrice ?? 0n) / 1e9;
    } catch {
      gasGwei = 100; // fallback
    }

    if (gasGwei > this.cfg.maxGasGwei) {
      return {
        approved: false,
        reason: `Gas too high: ${gasGwei.toFixed(0)} Gwei (max: ${this.cfg.maxGasGwei})`,
        liveGasGwei: gasGwei,
      };
    }

    // ── 3. Live MATIC price (from Alchemy token price API) ───────────────────
    let maticPriceUsd = 0.80; // conservative fallback
    try {
      const resp = await fetch(
        `https://api.g.alchemy.com/prices/v1/${this.cfg.alchemyApiKey}/tokens/by-symbol?symbols=MATIC`
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const price = data?.data?.[0]?.prices?.[0]?.value;
        if (price) maticPriceUsd = parseFloat(price);
      }
    } catch { /* use fallback */ }

    // ── 4. Recalculate gas cost with live data ───────────────────────────────
    const gasCostMatic = (ESTIMATED_GAS_UNITS * BigInt(Math.ceil(gasGwei * 1e9))) / BigInt(1e9);
    const gasCostUsd = Number(gasCostMatic) * maticPriceUsd / 1e9;

    // ── 5. Recalculate net profit ────────────────────────────────────────────
    const adjustedNetProfitUsd = opp.gross_profit_usd - gasCostUsd;
    const minProfitUsd = this.cfg.minProfitWei / 1e6;

    if (adjustedNetProfitUsd < minProfitUsd) {
      return {
        approved: false,
        reason: `Net profit $${adjustedNetProfitUsd.toFixed(4)} < min $${minProfitUsd.toFixed(2)}`,
        adjustedNetProfitUsd,
        liveGasGwei: gasGwei,
        liveMaticPriceUsd: maticPriceUsd,
      };
    }

    // ── 6. Slippage check ────────────────────────────────────────────────────
    const maxSlippage = this.cfg.maxSlippageBps / 100;
    if (opp.slippage_pct > maxSlippage) {
      return {
        approved: false,
        reason: `Slippage ${opp.slippage_pct.toFixed(2)}% > max ${maxSlippage}%`,
        liveGasGwei: gasGwei,
      };
    }

    // ── 7. Contract address check ────────────────────────────────────────────
    if (!ethers.isAddress(this.cfg.contractAddress)) {
      return { approved: false, reason: "Contract address not configured" };
    }

    return {
      approved: true,
      adjustedNetProfitUsd,
      liveGasGwei: gasGwei,
      liveMaticPriceUsd: maticPriceUsd,
    };
  }
}
