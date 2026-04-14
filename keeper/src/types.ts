// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface Opportunity {
  pair_name: string;
  buy_dex: string;
  sell_dex: string;
  buy_dex_addr: string;
  sell_dex_addr: string;
  loan_token: string;
  profit_token: string;
  loan_amount_raw: string;
  spread_pct: number;
  slippage_pct: number;
  gas_cost_usd: number;
  gross_profit_usd: number;
  net_profit_usd: number;
  confidence: number;
  timestamp_ms: number;
}

export type TradeStatus = "pending" | "submitted" | "confirmed" | "failed" | "skipped";

export interface TradeRecord {
  id: string;
  opportunity: Opportunity;
  status: TradeStatus;
  txHash?: string;
  actualProfitUsd?: number;
  gasUsed?: number;
  gasCostUsd?: number;
  errorMessage?: string;
  createdAt: number;
  confirmedAt?: number;
  skipReason?: string;
}

export interface BotStatus {
  running: boolean;
  autoExecute: boolean;
  scanCount: number;
  opportunityCount: number;
  executedCount: number;
  failedCount: number;
  totalProfitUsd: number;
  totalGasCostUsd: number;
  gasPrice: number;   // current Gwei
  maticPrice: number; // current USD
  uptime: number;     // seconds
  contractAddress: string;
  profitWallet: string;
}
