/**
 * Core types for MEV arbitrage engine
 */

export interface PoolState {
  address: string;
  token0: string;
  token1: string;
  reserve0: number;
  reserve1: number;
  fee: number;
}

export interface Trade {
  id: string;
  pool1: string;
  pool2: string;
  amountIn: number;
  expectedProfit: number;
  executedAt: number;
  status: 'pending' | 'executing' | 'success' | 'failed' | 'skipped';
}

export interface MEVRiskAnalysis {
  sandwichRiskScore: number;
  slippageRiskScore: number;
  liquidityRiskScore: number;
  gasPriceRiskScore: number;
  overallRiskScore: number;
  isSafe: boolean;
  recommendation: 'EXECUTE' | 'ANALYZE' | 'SKIP';
}

export interface ScannerMetrics {
  poolsScanned: number;
  opportunitiesFound: number;
  avgScanTimeMs: number;
  lastScanAt: number;
}

export interface ExecutionMetrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  skippedTrades: number;
  totalProfit: number;
  avgExecutionTimeMs: number;
}

export interface EngineConfig {
  minProfitUsd: number;
  maxSlippagePct: number;
  maxGasPriceGwei: number;
  minLiquidityUsd: number;
  scanIntervalMs: number;
}
