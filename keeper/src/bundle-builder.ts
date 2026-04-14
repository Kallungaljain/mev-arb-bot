// ─── Bundle Builder ───────────────────────────────────────────────────────────
//
// Constructs the transaction calldata for calling EliteAntArb.executeArb()
// with the correct parameters from the opportunity.

import { ethers } from "ethers";
import { KeeperConfig } from "./config";
import { Opportunity } from "./types";

// EliteAntArb ABI — only the executeArb function
const EXECUTE_ARB_ABI = [
  "function executeArb(address loanToken, uint256 loanAmount, address buyDex, address sellDex, address profitToken, uint256 minProfit) external",
];

export interface Bundle {
  to: string;
  data: string;
  gasLimit: bigint;
  loanToken: string;
  loanAmount: bigint;
  minProfit: bigint;
}

export class BundleBuilder {
  private iface: ethers.Interface;

  constructor(private cfg: KeeperConfig) {
    this.iface = new ethers.Interface(EXECUTE_ARB_ABI);
  }

  build(opp: Opportunity, adjustedMinProfitUsd: number): Bundle {
    const loanAmount = BigInt(opp.loan_amount_raw);

    // Convert min profit from USD to token units
    // For USDC (6 decimals): $0.50 = 500_000
    // For WMATIC (18 decimals): use a conservative estimate
    const minProfitWei = BigInt(this.cfg.minProfitWei);

    // Build calldata
    const data = this.iface.encodeFunctionData("executeArb", [
      opp.loan_token,
      loanAmount,
      opp.buy_dex_addr,
      opp.sell_dex_addr,
      opp.profit_token,
      minProfitWei,
    ]);

    return {
      to: this.cfg.contractAddress,
      data,
      gasLimit: 500_000n, // generous limit; actual gas ~350k
      loanToken: opp.loan_token,
      loanAmount,
      minProfit: minProfitWei,
    };
  }

  describe(bundle: Bundle): string {
    return `executeArb(${bundle.loanToken.slice(0, 8)}..., ${bundle.loanAmount}, gasLimit=${bundle.gasLimit})`;
  }
}
