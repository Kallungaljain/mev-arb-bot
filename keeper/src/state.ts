import { Opportunity, TradeRecord, BotStatus } from "./types";
import { randomUUID } from "crypto";

export class StateManager {
  private _running = false;
  private _autoExecute = false;
  private _scanCount = 0;
  private _opportunityCount = 0;
  private _executedCount = 0;
  private _failedCount = 0;
  private _totalProfitUsd = 0;
  private _totalGasCostUsd = 0;
  private _gasPrice = 100;    // Gwei
  private _maticPrice = 0.80; // USD
  private _startTime = Date.now();
  private _contractAddress = "";
  private _profitWallet = "";

  // Recent opportunities (last 50)
  private _opportunities: Opportunity[] = [];
  // Trade history (last 200)
  private _trades: TradeRecord[] = [];

  // ── Getters ──────────────────────────────────────────────────────────────

  get running() { return this._running; }
  get autoExecute() { return this._autoExecute; }
  get opportunities() { return [...this._opportunities]; }
  get trades() { return [...this._trades]; }

  getStatus(contractAddress: string, profitWallet: string): BotStatus {
    return {
      running: this._running,
      autoExecute: this._autoExecute,
      scanCount: this._scanCount,
      opportunityCount: this._opportunityCount,
      executedCount: this._executedCount,
      failedCount: this._failedCount,
      totalProfitUsd: this._totalProfitUsd,
      totalGasCostUsd: this._totalGasCostUsd,
      gasPrice: this._gasPrice,
      maticPrice: this._maticPrice,
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
      contractAddress,
      profitWallet,
    };
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  setRunning(v: boolean) { this._running = v; }
  setAutoExecute(v: boolean) { this._autoExecute = v; }
  setGasPrice(gwei: number) { this._gasPrice = gwei; }
  setMaticPrice(usd: number) { this._maticPrice = usd; }

  incrementScanCount() { this._scanCount++; }

  addOpportunity(opp: Opportunity) {
    this._opportunityCount++;
    this._opportunities.unshift(opp);
    if (this._opportunities.length > 50) {
      this._opportunities = this._opportunities.slice(0, 50);
    }
  }

  recordTrade(opp: Opportunity, status: TradeRecord["status"], extra: Partial<TradeRecord> = {}): TradeRecord {
    const trade: TradeRecord = {
      id: randomUUID(),
      opportunity: opp,
      status,
      createdAt: Date.now(),
      ...extra,
    };

    if (status === "confirmed") {
      this._executedCount++;
      this._totalProfitUsd += trade.actualProfitUsd ?? 0;
      this._totalGasCostUsd += trade.gasCostUsd ?? 0;
    } else if (status === "failed") {
      this._failedCount++;
    }

    this._trades.unshift(trade);
    if (this._trades.length > 200) {
      this._trades = this._trades.slice(0, 200);
    }

    return trade;
  }
}
