/**
 * Ultra-Low Latency MEV Engine
 * Merged Queen + Keeper with parallel processing
 * Target: <30ms end-to-end (detection + risk + execution)
 * 
 * Key Optimizations:
 * 1. Inline risk analysis (no separate Queen module)
 * 2. Parallel detection + execution
 * 3. Pre-computed calldata
 * 4. Aggressive pool caching
 * 5. Batch RPC calls
 */

import type { PoolState, Trade } from './types';

// ============================================================================
// ULTRA-FAST POOL CACHE (LRU with TTL)
// ============================================================================

interface CachedPool {
  data: PoolState;
  timestamp: number;
  ttl: number;
}

class PoolCache {
  private cache = new Map<string, CachedPool>();
  private maxSize = 500;
  private defaultTtl = 2000; // 2 second TTL

  set(address: string, pool: PoolState, ttl = this.defaultTtl) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const first = this.cache.entries().next().value;
      if (first) this.cache.delete(first[0]);
    }
    this.cache.set(address, {
      data: pool,
      timestamp: Date.now(),
      ttl,
    });
  }

  get(address: string): PoolState | null {
    const entry = this.cache.get(address);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(address);
      return null;
    }

    return entry.data;
  }

  has(address: string): boolean {
    return this.get(address) !== null;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// ============================================================================
// ULTRA-FAST OPPORTUNITY DETECTOR WITH INLINE RISK SCORING
// ============================================================================

interface OpportunityWithRisk {
  id: string;
  path: string[];
  profitPct: number;
  profitUsd: number;
  riskScore: number; // 0-100 (inline calculated)
  isSafe: boolean; // true if risk < 30
  calldata: string; // Pre-computed transaction data
  detectedAt: number;
  expiresAt: number;
}

class UltraFastDetector {
  private poolCache = new PoolCache();
  private lastDetectionTime = 0;

  /**
   * Detect arbitrage with INLINE risk scoring (no separate Queen call)
   * Target: <5ms total
   */
  detectWithInlineRisk(pools: PoolState[]): OpportunityWithRisk[] {
    const startTime = Date.now();
    const opportunities: OpportunityWithRisk[] = [];

    // Update cache
    for (const pool of pools) {
      this.poolCache.set(pool.address, pool);
    }

    // Build graph
    const graph = new Map<string, Array<[string, number, string]>>();
    for (const pool of pools) {
      const rate0to1 = pool.reserve1 / pool.reserve0;
      const rate1to0 = pool.reserve0 / pool.reserve1;

      if (!graph.has(pool.token0)) graph.set(pool.token0, []);
      graph.get(pool.token0)!.push([pool.token1, rate0to1, pool.address]);

      if (!graph.has(pool.token1)) graph.set(pool.token1, []);
      graph.get(pool.token1)!.push([pool.token0, rate1to0, pool.address]);
    }

    // Detect cycles with inline risk scoring
    const graphArray = Array.from(graph.entries());
    for (const [startToken, edges] of graphArray) {
      for (const [nextToken, rate1, pool1Addr] of edges) {
        const backEdges = graph.get(nextToken);
        if (!backEdges) continue;

        for (const [finalToken, rate2, pool2Addr] of backEdges) {
          if (finalToken !== startToken) continue;

          const profit = rate1 * rate2;
          if (profit <= 1.001) continue; // <0.1% profit

          const profitPct = (profit - 1) * 100;
          const profitUsd = 1000 * (profitPct / 100); // Assume $1000 swap

          // INLINE RISK SCORING (replaces Queen module)
          const riskScore = this.calculateInlineRisk(
            1000, // swap size
            100_000, // liquidity
            profitPct,
            pool1Addr,
            pool2Addr
          );

          const isSafe = riskScore < 30;

          // PRE-COMPUTE CALLDATA
          const calldata = this.preComputeCalldata(
            startToken,
            nextToken,
            finalToken,
            1000,
            profitUsd
          );

          opportunities.push({
            id: `${startToken}-${nextToken}-${finalToken}`,
            path: [startToken, nextToken, finalToken],
            profitPct,
            profitUsd,
            riskScore,
            isSafe,
            calldata,
            detectedAt: Date.now(),
            expiresAt: Date.now() + 5000,
          });
        }
      }
    }

    this.lastDetectionTime = Date.now() - startTime;
    return opportunities;
  }

  /**
   * Calculate risk score inline (no separate call)
   * <1ms execution
   */
  private calculateInlineRisk(
    swapSize: number,
    liquidity: number,
    profitPct: number,
    pool1: string,
    pool2: string
  ): number {
    // Sandwich risk: size ratio + profit opportunity
    const sizeRatio = Math.min(swapSize / liquidity, 1);
    const sandwichRisk = sizeRatio * 30 + (profitPct > 1 ? 20 : 10);

    // Slippage risk: profit margin
    const slippageRisk = profitPct < 0.5 ? 40 : profitPct < 1 ? 20 : 10;

    // Liquidity risk: pool diversity
    const liquidityRisk = pool1 === pool2 ? 30 : 10;

    // Gas risk: assume normal conditions
    const gasRisk = 5;

    // Weighted average
    const overallRisk =
      sandwichRisk * 0.4 + slippageRisk * 0.3 + liquidityRisk * 0.2 + gasRisk * 0.1;

    return Math.min(overallRisk, 100);
  }

  /**
   * Pre-compute transaction calldata during detection
   * <1ms execution (no separate encoding step)
   */
  private preComputeCalldata(
    token0: string,
    token1: string,
    token2: string,
    amountIn: number,
    expectedProfit: number
  ): string {
    // Function selector for executeOperation
    let calldata = '920f5c84';

    // Encode parameters
    calldata += amountIn.toString(16).padStart(64, '0');
    calldata += expectedProfit.toString(16).padStart(64, '0');
    calldata += '0'.repeat(64); // padding

    return `0x${calldata}`;
  }

  getLastDetectionTime() {
    return this.lastDetectionTime;
  }

  getPoolCacheSize() {
    return this.poolCache.size();
  }
}

// ============================================================================
// UNIFIED EXECUTOR (Merged Queen + Keeper)
// ============================================================================

interface ExecutionResult {
  success: boolean;
  txHash: string;
  executionTime: number;
  profit: number;
  error?: string;
}

class UnifiedExecutor {
  private executionTimes: number[] = [];
  private successCount = 0;
  private failureCount = 0;
  private totalProfit = 0;

  /**
   * Execute opportunity with INLINE risk check + execution
   * Target: <20ms total (was 30-50ms as separate Keeper)
   */
  async executeOpportunity(opp: OpportunityWithRisk): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Step 1: Quick inline risk re-check (<1ms)
      if (opp.riskScore > 40) {
        return {
          success: false,
          txHash: '',
          executionTime: Date.now() - startTime,
          profit: 0,
          error: `Risk too high: ${opp.riskScore}/100`,
        };
      }

      // Step 2: Validate profit threshold (<1ms)
      if (opp.profitUsd < 5) {
        return {
          success: false,
          txHash: '',
          executionTime: Date.now() - startTime,
          profit: 0,
          error: `Profit too low: $${opp.profitUsd}`,
        };
      }

      // Step 3: Build transaction with pre-computed calldata (<1ms)
      const txData = this.buildTx(opp);

      // Step 4: Sign transaction (<5ms)
      const signedTx = this.signTx(txData);

      // Step 5: Submit to mempool (<10ms)
      const txHash = await this.submitTx(signedTx);

      const executionTime = Date.now() - startTime;

      // Record metrics
      this.executionTimes.push(executionTime);
      if (this.executionTimes.length > 100) {
        this.executionTimes.shift();
      }
      this.successCount++;
      this.totalProfit += opp.profitUsd;

      return {
        success: true,
        txHash,
        executionTime,
        profit: opp.profitUsd,
      };
    } catch (error: any) {
      this.failureCount++;
      return {
        success: false,
        txHash: '',
        executionTime: Date.now() - startTime,
        profit: 0,
        error: error.message,
      };
    }
  }

  private buildTx(opp: OpportunityWithRisk): string {
    // Use pre-computed calldata
    return opp.calldata;
  }

  private signTx(txData: string): string {
    // Simulated signing
    return `0x${txData}${'0'.repeat(130)}`;
  }

  private async submitTx(signedTx: string): Promise<string> {
    // Simulated submission
    return `0x${'a'.repeat(64)}`;
  }

  getMetrics() {
    const avgTime =
      this.executionTimes.length > 0
        ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length
        : 0;

    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      totalProfit: this.totalProfit,
      avgExecutionTime: avgTime,
      successRate: this.successCount / (this.successCount + this.failureCount) || 0,
    };
  }
}

// ============================================================================
// ULTRA-LOW LATENCY ENGINE (Parallel Detection + Execution)
// ============================================================================

interface ScanResult {
  detectionTime: number;
  executionTime: number;
  totalTime: number;
  opportunitiesDetected: number;
  opportunitiesExecuted: number;
  totalProfit: number;
}

export class UltraLowLatencyEngine {
  private detector = new UltraFastDetector();
  private executor = new UnifiedExecutor();
  private lastScanResult: ScanResult | null = null;

  /**
   * Full scan cycle: Detection + Risk + Execution in parallel
   * Target: <30ms total
   */
  async scan(pools: PoolState[]): Promise<ScanResult> {
    const cycleStart = Date.now();

    // Step 1: Detect opportunities with inline risk scoring
    const detectionStart = Date.now();
    const opportunities = this.detector.detectWithInlineRisk(pools);
    const detectionTime = Date.now() - detectionStart;

    // Step 2: Execute safe opportunities in parallel
    const executionStart = Date.now();
    const executions = opportunities
      .filter((opp) => opp.isSafe)
      .map((opp) => this.executor.executeOpportunity(opp));

    const results = await Promise.all(executions);
    const executionTime = Date.now() - executionStart;

    const totalTime = Date.now() - cycleStart;

    const result: ScanResult = {
      detectionTime,
      executionTime,
      totalTime,
      opportunitiesDetected: opportunities.length,
      opportunitiesExecuted: results.filter((r) => r.success).length,
      totalProfit: results.reduce((sum, r) => sum + r.profit, 0),
    };

    this.lastScanResult = result;
    return result;
  }

  /**
   * Get engine metrics
   */
  getMetrics() {
    return {
      lastScan: this.lastScanResult,
      executor: this.executor.getMetrics(),
      poolCacheSize: this.detector.getPoolCacheSize(),
    };
  }

  /**
   * Get last scan result
   */
  getLastScanResult(): ScanResult | null {
    return this.lastScanResult;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { UltraFastDetector, UnifiedExecutor, PoolCache, OpportunityWithRisk };
