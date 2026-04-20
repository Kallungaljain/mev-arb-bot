/**
 * Profit Validator
 * 
 * Validates that trades are actually profitable before execution.
 * Uses real pool state and slippage calculations.
 */

import { Provider } from 'ethers';
import { PoolStateTracker, type PoolState } from './pool-state-tracker';
import { SlippageCalculator, type ArbitrageSimulation } from './slippage-calculator';

export interface Opportunity {
  id: string;
  pair: string;
  token0: string;
  token1: string;
  buyDex: string;
  sellDex: string;
  borrowAmount: bigint;
  priceUSD: number;
  spreadPercent: number;
  timestamp: number;
}

export interface ValidationResult {
  isValid: boolean;
  estimatedProfit: bigint;
  estimatedProfitUSD: number;
  profitPercent: number;
  confidence: number;
  simulation: ArbitrageSimulation | null;
  reason: string;
  staleness: {
    buyPoolMs: number;
    sellPoolMs: number;
  };
}

export class ProfitValidator {
  private poolTracker: PoolStateTracker;
  private slippageCalc: SlippageCalculator;
  private minProfitThreshold: bigint;
  private minProfitPercent: number;
  private maxPoolStalenessMs: number;

  constructor(
    poolTracker: PoolStateTracker,
    minProfitThreshold: bigint = BigInt(1000000), // 1 USDC (6 decimals)
    minProfitPercent: number = 0.1, // 0.1%
    maxPoolStalenessMs: number = 500
  ) {
    this.poolTracker = poolTracker;
    this.slippageCalc = new SlippageCalculator();
    this.minProfitThreshold = minProfitThreshold;
    this.minProfitPercent = minProfitPercent;
    this.maxPoolStalenessMs = maxPoolStalenessMs;
  }

  /**
   * Validate opportunity is actually profitable
   */
  async validateProfit(
    opportunity: Opportunity,
    provider: Provider
  ): Promise<ValidationResult> {
    try {
      // Step 1: Update pool states if needed
      if (this.poolTracker.isStale(opportunity.buyDex, this.maxPoolStalenessMs)) {
        await this.poolTracker.updatePoolState(opportunity.buyDex, provider);
      }

      if (this.poolTracker.isStale(opportunity.sellDex, this.maxPoolStalenessMs)) {
        await this.poolTracker.updatePoolState(opportunity.sellDex, provider);
      }

      // Step 2: Get current pool states
      const buyPoolState = this.poolTracker.getPoolState(opportunity.buyDex);
      const sellPoolState = this.poolTracker.getPoolState(opportunity.sellDex);

      if (!buyPoolState || !sellPoolState) {
        return {
          isValid: false,
          estimatedProfit: BigInt(0),
          estimatedProfitUSD: 0,
          profitPercent: 0,
          confidence: 0,
          simulation: null,
          reason: 'Pool state not available',
          staleness: {
            buyPoolMs: this.poolTracker.getStalenessMs(opportunity.buyDex),
            sellPoolMs: this.poolTracker.getStalenessMs(opportunity.sellDex),
          },
        };
      }

      // Step 3: Check staleness
      const buyPoolStaleness = this.poolTracker.getStalenessMs(opportunity.buyDex);
      const sellPoolStaleness = this.poolTracker.getStalenessMs(opportunity.sellDex);

      if (buyPoolStaleness > this.maxPoolStalenessMs || sellPoolStaleness > this.maxPoolStalenessMs) {
        return {
          isValid: false,
          estimatedProfit: BigInt(0),
          estimatedProfitUSD: 0,
          profitPercent: 0,
          confidence: 0,
          simulation: null,
          reason: `Pool state stale (buy: ${buyPoolStaleness}ms, sell: ${sellPoolStaleness}ms)`,
          staleness: {
            buyPoolMs: buyPoolStaleness,
            sellPoolMs: sellPoolStaleness,
          },
        };
      }

      // Step 4: Simulate arbitrage with real pool data
      const simulation = this.slippageCalc.simulateArbitrage(
        opportunity.borrowAmount,
        {
          reserve0: buyPoolState.reserve0,
          reserve1: buyPoolState.reserve1,
        },
        {
          reserve0: sellPoolState.reserve0,
          reserve1: sellPoolState.reserve1,
        },
        0.05 // AAVE fee 0.05%
      );

      // Step 5: Check profitability
      const isProfitable = this.slippageCalc.isProfitable(
        simulation,
        this.minProfitThreshold,
        this.minProfitPercent
      );

      const estimatedProfitUSD = Number(simulation.profitAmount) * opportunity.priceUSD;

      // Step 6: Calculate confidence score
      // Higher profit % = higher confidence
      // Lower staleness = higher confidence
      // Lower slippage = higher confidence
      let confidence = 0;

      // Profit confidence (0-40 points)
      if (simulation.profitPercent > 1) confidence += 40;
      else if (simulation.profitPercent > 0.5) confidence += 30;
      else if (simulation.profitPercent > 0.2) confidence += 20;
      else if (simulation.profitPercent > 0.1) confidence += 10;

      // Staleness confidence (0-30 points)
      const maxStaleness = Math.max(buyPoolStaleness, sellPoolStaleness);
      if (maxStaleness < 100) confidence += 30;
      else if (maxStaleness < 250) confidence += 20;
      else if (maxStaleness < 500) confidence += 10;

      // Slippage confidence (0-30 points)
      const slippagePercent = Number((simulation.slippageLoss * BigInt(10000)) / opportunity.borrowAmount) / 100;
      if (slippagePercent < 0.1) confidence += 30;
      else if (slippagePercent < 0.3) confidence += 20;
      else if (slippagePercent < 0.5) confidence += 10;

      return {
        isValid: isProfitable,
        estimatedProfit: simulation.profitAmount,
        estimatedProfitUSD,
        profitPercent: simulation.profitPercent,
        confidence: Math.min(100, confidence),
        simulation,
        reason: isProfitable
          ? `Profitable: $${estimatedProfitUSD.toFixed(2)} (${simulation.profitPercent.toFixed(2)}%)`
          : `Not profitable: $${estimatedProfitUSD.toFixed(2)} (${simulation.profitPercent.toFixed(2)}%)`,
        staleness: {
          buyPoolMs: buyPoolStaleness,
          sellPoolMs: sellPoolStaleness,
        },
      };
    } catch (error: any) {
      return {
        isValid: false,
        estimatedProfit: BigInt(0),
        estimatedProfitUSD: 0,
        profitPercent: 0,
        confidence: 0,
        simulation: null,
        reason: `Validation error: ${error.message}`,
        staleness: {
          buyPoolMs: this.poolTracker.getStalenessMs(opportunity.buyDex),
          sellPoolMs: this.poolTracker.getStalenessMs(opportunity.sellDex),
        },
      };
    }
  }

  /**
   * Batch validate multiple opportunities
   */
  async validateMultiple(
    opportunities: Opportunity[],
    provider: Provider
  ): Promise<ValidationResult[]> {
    const results = await Promise.all(
      opportunities.map(opp => this.validateProfit(opp, provider))
    );

    return results;
  }

  /**
   * Get opportunities sorted by confidence
   */
  async getTopOpportunities(
    opportunities: Opportunity[],
    provider: Provider,
    limit: number = 10
  ): Promise<Array<{ opportunity: Opportunity; validation: ValidationResult }>> {
    const validations = await this.validateMultiple(opportunities, provider);

    return opportunities
      .map((opp, i) => ({
        opportunity: opp,
        validation: validations[i],
      }))
      .filter(item => item.validation.isValid)
      .sort((a, b) => b.validation.confidence - a.validation.confidence)
      .slice(0, limit);
  }

  /**
   * Update minimum profit threshold
   */
  setMinProfitThreshold(threshold: bigint) {
    this.minProfitThreshold = threshold;
  }

  /**
   * Update minimum profit percentage
   */
  setMinProfitPercent(percent: number) {
    this.minProfitPercent = percent;
  }

  /**
   * Update maximum pool staleness tolerance
   */
  setMaxPoolStalenessMs(ms: number) {
    this.maxPoolStalenessMs = ms;
  }

  /**
   * Get validator configuration
   */
  getConfig() {
    return {
      minProfitThreshold: this.minProfitThreshold.toString(),
      minProfitPercent: this.minProfitPercent,
      maxPoolStalenessMs: this.maxPoolStalenessMs,
    };
  }
}
