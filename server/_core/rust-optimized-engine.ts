/**
 * Ultra-low latency MEV arbitrage engine
 * TypeScript implementation of Rust optimizations
 * Target: <100ms end-to-end latency
 */

import type { PoolState, Trade, MEVRiskAnalysis } from './types';

// ============================================================================
// BELLMAN-FORD DETECTOR (1-2ms for 100 vertices)
// ============================================================================

interface Edge {
  from: string;
  to: string;
  weight: number;
}

class BellmanFordDetector {
  private vertices: string[] = [];
  private edges: Edge[] = [];
  private distances: Map<string, number> = new Map();

  addVertex(token: string) {
    if (!this.vertices.includes(token)) {
      this.vertices.push(token);
      this.distances.set(token, 0);
    }
  }

  addEdge(from: string, to: string, rate: number) {
    this.addVertex(from);
    this.addVertex(to);
    const weight = -Math.log(rate);
    this.edges.push({ from, to, weight });
  }

  detectArbitrage(source: string) {
    // Initialize distances
    for (const vertex of this.vertices) {
      this.distances.set(vertex, Infinity);
    }
    this.distances.set(source, 0);

    // Relax edges V-1 times
    for (let i = 0; i < this.vertices.length - 1; i++) {
      for (const edge of this.edges) {
        const fromDist = this.distances.get(edge.from) ?? Infinity;
        if (fromDist !== Infinity) {
          const toDist = this.distances.get(edge.to) ?? Infinity;
          const newDist = fromDist + edge.weight;
          if (newDist < toDist) {
            this.distances.set(edge.to, newDist);
          }
        }
      }
    }

    // Detect negative cycles
    const opportunities = [];
    for (const edge of this.edges) {
      const fromDist = this.distances.get(edge.from) ?? Infinity;
      if (fromDist !== Infinity) {
        const toDist = this.distances.get(edge.to) ?? Infinity;
        const newDist = fromDist + edge.weight;
        if (newDist < toDist) {
          const profitPct = (Math.exp(-newDist) - 1) * 100;
          if (profitPct > 0.1) {
            opportunities.push({
              path: [source, edge.to],
              profitPct,
            });
          }
        }
      }
    }

    return opportunities;
  }

  clear() {
    this.vertices = [];
    this.edges = [];
    this.distances.clear();
  }
}

// ============================================================================
// PROFIT SIMULATOR (2-5ms)
// ============================================================================

class ProfitSimulator {
  static simulateSwap(
    inputAmount: number,
    pool: PoolState,
    isToken0ToToken1: boolean
  ): number {
    const [reserveIn, reserveOut] = isToken0ToToken1
      ? [pool.reserve0, pool.reserve1]
      : [pool.reserve1, pool.reserve0];

    const feeAmount = inputAmount * (pool.fee / 100);
    const amountInWithFee = inputAmount - feeAmount;

    // x*y=k formula
    return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
  }

  static simulateArbitrage(
    initialAmountUsd: number,
    pool1: PoolState,
    pool2: PoolState,
    gasCostUsd: number,
    aaveFeePercent: number = 0.09
  ) {
    const borrowedAmount = initialAmountUsd;
    const aaveFee = borrowedAmount * (aaveFeePercent / 100);

    const amountAfterFirstSwap = this.simulateSwap(borrowedAmount, pool1, true);
    const amountAfterSecondSwap = this.simulateSwap(amountAfterFirstSwap, pool2, false);

    const totalRepay = borrowedAmount + aaveFee;
    const netProfit = amountAfterSecondSwap - totalRepay - gasCostUsd;

    return {
      inputAmount: borrowedAmount,
      outputAmount: amountAfterSecondSwap,
      netProfitUsd: netProfit,
      isProfitable: netProfit > 0,
      totalFeeUsd: aaveFee + gasCostUsd,
    };
  }
}

// ============================================================================
// QUEEN: MEV RISK ANALYZER (2-5ms)
// ============================================================================

interface PoolMetrics {
  liquidityUsd: number;
  volume24h: number;
  priceVolatility: number;
  swapCount1h: number;
}

class Queen {
  static analyzeSandwichRisk(
    swapSizeUsd: number,
    liquidityUsd: number,
    mempoolPendingTxs: number
  ): number {
    const sizeRatio = Math.min(swapSizeUsd / liquidityUsd, 1);
    const baseRisk = sizeRatio * 50;
    const mempoolRisk = Math.min((mempoolPendingTxs / 100) * 50, 50);
    return Math.min(baseRisk + mempoolRisk, 100);
  }

  static analyzeSlippageRisk(
    volatilityPct: number,
    volume24h: number,
    swapSizeUsd: number
  ): number {
    const volRisk = Math.min((volatilityPct / 2) * 50, 50);
    const volumeRatio = Math.min(swapSizeUsd / volume24h, 1);
    const volumeRisk = volumeRatio * 50;
    return Math.min(volRisk + volumeRisk, 100);
  }

  static analyzeLiquidityRisk(
    swapSizeUsd: number,
    liquidityUsd: number,
    minLiquidityRatio: number
  ): number {
    const ratio = swapSizeUsd / liquidityUsd;
    if (ratio > 0.5) return 100;
    if (ratio > 0.2) return ((ratio - 0.2) / 0.3) * 100;
    if (ratio > minLiquidityRatio) return (ratio / minLiquidityRatio) * 30;
    return 0;
  }

  static analyzeGasPriceRisk(
    currentGasGwei: number,
    avgGasGwei: number
  ): number {
    const ratio = currentGasGwei / avgGasGwei;
    if (ratio > 2) return 100;
    if (ratio > 1.5) return (ratio - 1) * 100;
    if (ratio > 1.1) return (ratio - 1) * 50;
    return 0;
  }

  static analyze(
    swapSizeUsd: number,
    poolMetrics: PoolMetrics,
    currentGasGwei: number,
    avgGasGwei: number,
    mempoolPendingTxs: number,
    minLiquidityRatio: number = 0.05
  ): MEVRiskAnalysis {
    const sandwichRisk = this.analyzeSandwichRisk(
      swapSizeUsd,
      poolMetrics.liquidityUsd,
      mempoolPendingTxs
    );

    const slippageRisk = this.analyzeSlippageRisk(
      poolMetrics.priceVolatility,
      poolMetrics.volume24h,
      swapSizeUsd
    );

    const liquidityRisk = this.analyzeLiquidityRisk(
      swapSizeUsd,
      poolMetrics.liquidityUsd,
      minLiquidityRatio
    );

    const gasPriceRisk = this.analyzeGasPriceRisk(currentGasGwei, avgGasGwei);

    const overallRisk =
      sandwichRisk * 0.35 +
      slippageRisk * 0.35 +
      liquidityRisk * 0.2 +
      gasPriceRisk * 0.1;

    const isSafe = overallRisk < 30;
    const recommendation =
      overallRisk < 20 ? 'EXECUTE' : overallRisk < 50 ? 'ANALYZE' : 'SKIP';

    return {
      sandwichRiskScore: sandwichRisk,
      slippageRiskScore: slippageRisk,
      liquidityRiskScore: liquidityRisk,
      gasPriceRiskScore: gasPriceRisk,
      overallRiskScore: overallRisk,
      isSafe,
      recommendation,
    };
  }

  static isTradesSafe(
    swapSizeUsd: number,
    liquidityUsd: number,
    volatilityPct: number
  ): boolean {
    const sizeRatio = swapSizeUsd / liquidityUsd;
    const volatilityOk = volatilityPct < 5;
    const sizeOk = sizeRatio < 0.1;
    return volatilityOk && sizeOk;
  }
}

// ============================================================================
// KEEPER: TRADE EXECUTION (30-50ms)
// ============================================================================

interface ExecutionMetrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  skippedTrades: number;
  totalProfit: number;
  avgExecutionTimeMs: number;
}

class Keeper {
  private trades: Trade[] = [];
  private metrics: ExecutionMetrics = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    skippedTrades: 0,
    totalProfit: 0,
    avgExecutionTimeMs: 0,
  };
  private executionTimes: number[] = [];

  async executeSafeTrade(trade: Trade): Promise<number> {
    const start = Date.now();

    // Validate
    if (trade.amountIn <= 0 || trade.expectedProfit <= 0) {
      throw new Error('Invalid trade parameters');
    }

    // Build transaction (2-3ms)
    const txData = this.buildTransaction(trade);

    // Sign (5-10ms) - simulated
    const signedTx = this.signTransaction(txData);

    // Submit (20-30ms) - simulated
    const txHash = await this.submitTransaction(signedTx);

    const executionTime = Date.now() - start;

    this.trades.push(trade);
    this.executionTimes.push(executionTime);

    if (this.executionTimes.length > 100) {
      this.executionTimes.shift();
    }

    return executionTime;
  }

  private buildTransaction(trade: Trade): string {
    return `0x920f5c84${trade.amountIn.toString(16).padStart(64, '0')}`;
  }

  private signTransaction(txData: string): string {
    return `0x${txData}${'0'.repeat(130)}`;
  }

  private async submitTransaction(signedTx: string): Promise<string> {
    // Simulated submission
    return `0x${'a'.repeat(64)}`;
  }

  recordSuccess(profit: number) {
    this.metrics.successfulTrades++;
    this.metrics.totalTrades++;
    this.metrics.totalProfit += profit;
  }

  recordFailure() {
    this.metrics.failedTrades++;
    this.metrics.totalTrades++;
  }

  recordSkip() {
    this.metrics.skippedTrades++;
    this.metrics.totalTrades++;
  }

  getMetrics(): ExecutionMetrics {
    return {
      ...this.metrics,
      avgExecutionTimeMs:
        this.executionTimes.length > 0
          ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length
          : 0,
    };
  }

  getTrades(): Trade[] {
    return this.trades;
  }
}

// ============================================================================
// SCANNER: REAL-TIME POOL MONITORING (<10ms)
// ============================================================================

interface ArbitrageOpportunity {
  id: string;
  path: string[];
  profitPct: number;
  profitUsd: number;
  detectedAt: number;
  expiresAt: number;
}

interface ScannerMetrics {
  poolsScanned: number;
  opportunitiesFound: number;
  avgScanTimeMs: number;
  lastScanAt: number;
}

class Scanner {
  private pools: Map<string, PoolState> = new Map();
  private opportunities: ArbitrageOpportunity[] = [];
  private metrics: ScannerMetrics = {
    poolsScanned: 0,
    opportunitiesFound: 0,
    avgScanTimeMs: 0,
    lastScanAt: 0,
  };
  private scanTimes: number[] = [];

  async scan(): Promise<ArbitrageOpportunity[]> {
    const start = Date.now();

    // Fetch pool data (5-10ms)
    const pools = await this.fetchPoolData();

    // Build graph (1-2ms)
    const graph = this.buildGraph(pools);

    // Detect arbitrage (2-5ms)
    const opportunities = this.detectArbitrage(graph);

    // Filter (1-2ms)
    const filtered = this.filterOpportunities(opportunities);

    const scanTime = Date.now() - start;

    this.scanTimes.push(scanTime);
    if (this.scanTimes.length > 100) {
      this.scanTimes.shift();
    }

    this.metrics = {
      poolsScanned: pools.length,
      opportunitiesFound: filtered.length,
      avgScanTimeMs:
        this.scanTimes.reduce((a, b) => a + b, 0) / this.scanTimes.length,
      lastScanAt: Date.now(),
    };

    this.opportunities.push(...filtered);
    if (this.opportunities.length > 1000) {
      this.opportunities = this.opportunities.slice(-1000);
    }

    return filtered;
  }

  private async fetchPoolData(): Promise<PoolState[]> {
    // Mock data for now
    return [
      {
        address: '0xquickswap',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1_000_000,
        reserve1: 1_850_000,
        fee: 0.3,
      },
      {
        address: '0xsushiswap',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 500_000,
        reserve1: 900_000,
        fee: 0.3,
      },
    ];
  }

  private buildGraph(pools: PoolState[]): Map<string, Array<[string, number]>> {
    const graph: Map<string, Array<[string, number]>> = new Map();

    for (const pool of pools) {
      const rate0to1 = pool.reserve1 / pool.reserve0;
      const rate1to0 = pool.reserve0 / pool.reserve1;

      if (!graph.has(pool.token0)) graph.set(pool.token0, []);
      graph.get(pool.token0)!.push([pool.token1, rate0to1]);

      if (!graph.has(pool.token1)) graph.set(pool.token1, []);
      graph.get(pool.token1)!.push([pool.token0, rate1to0]);
    }

    return graph;
  }

  private detectArbitrage(
    graph: Map<string, Array<[string, number]>>
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    const graphArray = Array.from(graph.entries());
    for (const [startToken, edges] of graphArray) {
      for (const [nextToken, rate1] of edges) {
        const backEdges = graph.get(nextToken);
        if (backEdges) {
          for (const [finalToken, rate2] of backEdges) {
            if (finalToken === startToken) {
              const profit = rate1 * rate2;
              if (profit > 1.001) {
                opportunities.push({
                  id: `${startToken}-${nextToken}-${finalToken}`,
                  path: [startToken, nextToken, finalToken],
                  profitPct: (profit - 1) * 100,
                  profitUsd: 0,
                  detectedAt: Date.now(),
                  expiresAt: Date.now() + 5000,
                });
              }
            }
          }
        }
      }
    }

    return opportunities;
  }

  private filterOpportunities(
    opps: ArbitrageOpportunity[]
  ): ArbitrageOpportunity[] {
    return opps.filter((opp) => opp.profitPct > 0.5);
  }

  getOpportunities(): ArbitrageOpportunity[] {
    const now = Date.now();
    return this.opportunities.filter((opp) => opp.expiresAt > now);
  }

  getMetrics(): ScannerMetrics {
    return this.metrics;
  }
}

// ============================================================================
// MAIN ENGINE
// ============================================================================

export class RustOptimizedEngine {
  private scanner = new Scanner();
  private keeper = new Keeper();
  private bellmanFord = new BellmanFordDetector();

  async scan() {
    return this.scanner.scan();
  }

  async executeTrade(trade: Trade) {
    return this.keeper.executeSafeTrade(trade);
  }

  recordSuccess(profit: number) {
    this.keeper.recordSuccess(profit);
  }

  recordFailure() {
    this.keeper.recordFailure();
  }

  getMetrics() {
    return {
      scanner: this.scanner.getMetrics(),
      keeper: this.keeper.getMetrics(),
    };
  }

  getOpportunities() {
    return this.scanner.getOpportunities();
  }

  static ProfitSimulator = ProfitSimulator;
  static Queen = Queen;
  static BellmanFordDetector = BellmanFordDetector;
}

export { BellmanFordDetector, ProfitSimulator, Queen, Keeper, Scanner };
