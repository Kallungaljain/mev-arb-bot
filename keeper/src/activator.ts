// ─── Flash Loan Activator ─────────────────────────────────────────────────────
//
// Signs and submits the flash loan arbitrage transaction to Polygon.
// Monitors the transaction for confirmation and records the result.

import { ethers } from "ethers";
import { KeeperConfig } from "./config";
import { Bundle } from "./bundle-builder";
import { StateManager } from "./state";
import { Opportunity, TradeRecord } from "./types";

export class FlashLoanActivator {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor(
    private cfg: KeeperConfig,
    private state: StateManager,
  ) {
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new ethers.Wallet(cfg.privateKey, this.provider);
    console.log(`Keeper wallet: ${this.wallet.address}`);
  }

  async execute(opp: Opportunity, bundle: Bundle): Promise<TradeRecord> {
    // Record as pending
    const trade = this.state.recordTrade(opp, "pending");

    try {
      // Get current nonce
      const nonce = await this.provider.getTransactionCount(this.wallet.address, "latest");

      // Get current gas price (with 10% tip)
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice
        ? (feeData.gasPrice * 110n) / 100n  // +10% to ensure inclusion
        : ethers.parseUnits("100", "gwei");

      console.log(`Submitting tx: executeArb(${bundle.loanToken.slice(0, 8)}..., ${bundle.loanAmount})`);
      console.log(`Gas price: ${Number(gasPrice) / 1e9} Gwei | Nonce: ${nonce}`);

      // Send transaction
      const tx = await this.wallet.sendTransaction({
        to: bundle.to,
        data: bundle.data,
        gasLimit: bundle.gasLimit,
        gasPrice,
        nonce,
      });

      console.log(`Tx submitted: ${tx.hash}`);

      // Update trade record with tx hash
      trade.txHash = tx.hash;
      trade.status = "submitted";

      // Wait for confirmation (timeout: 30s)
      const receipt = await Promise.race([
        tx.wait(1),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000)),
      ]);

      if (!receipt) {
        trade.status = "failed";
        trade.errorMessage = "Transaction confirmation timeout (30s)";
        console.warn(`Tx timeout: ${tx.hash}`);
        return trade;
      }

      if (receipt.status === 0) {
        trade.status = "failed";
        trade.errorMessage = "Transaction reverted on-chain";
        console.warn(`Tx reverted: ${tx.hash}`);
        return trade;
      }

      // Confirmed successfully
      const gasUsed = Number(receipt.gasUsed);
      const gasCostWei = receipt.gasUsed * receipt.gasPrice;
      const maticPrice = 0.80; // TODO: use live price from state
      const gasCostUsd = Number(gasCostWei) * maticPrice / 1e18;

      trade.status = "confirmed";
      trade.gasUsed = gasUsed;
      trade.gasCostUsd = gasCostUsd;
      trade.actualProfitUsd = opp.net_profit_usd - gasCostUsd;
      trade.confirmedAt = Date.now();

      // Update state with confirmed trade
      this.state.recordTrade(opp, "confirmed", {
        txHash: tx.hash,
        gasUsed,
        gasCostUsd,
        actualProfitUsd: trade.actualProfitUsd,
        confirmedAt: trade.confirmedAt,
      });

      console.log(`✅ Arb confirmed: ${tx.hash} | Profit: $${trade.actualProfitUsd?.toFixed(4)}`);
      return trade;

    } catch (err: any) {
      trade.status = "failed";
      trade.errorMessage = err?.message ?? "Unknown error";
      console.error(`Tx failed: ${err?.message}`);

      this.state.recordTrade(opp, "failed", {
        errorMessage: trade.errorMessage,
      });

      return trade;
    }
  }

  async getWalletBalance(): Promise<{ matic: string; address: string }> {
    const balance = await this.provider.getBalance(this.wallet.address);
    return {
      matic: ethers.formatEther(balance),
      address: this.wallet.address,
    };
  }
}
