/**
 * MEV Risk Detector
 * 
 * Detects sandwich attack risk and MEV exposure.
 * Helps decide whether to execute via Flashbots or public mempool.
 */

import { Provider } from 'ethers';

interface MEVRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number; // 0-100
  factors: {
    gasPrice: number;
    txFrequency: number;
    priceVolatility: number;
    poolLiquidity: number;
    competitionLevel: number;
  };
  recommendation: string;
}

export class MEVRiskDetector {
  private provider: Provider;
  private txHistory: Map<string, any[]> = new Map(); // pool -> recent txs
  private maxHistorySize = 100;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Assess MEV risk for a trade
   */
  async assessRisk(
    poolAddress: string,
    borrowAmount: bigint,
    expectedProfit: bigint
  ): Promise<MEVRiskAssessment> {
    try {
      // Get current gas price
      const gasPrice = await this.provider.getGasPrice();
      const gasPriceGwei = Number(gasPrice) / 1e9;

      // Get recent transactions on pool
      const recentTxs = await this.getRecentPoolTransactions(poolAddress);

      // Calculate risk factors
      const txFrequency = recentTxs.length;
      const priceVolatility = this.calculateVolatility(recentTxs);
      const poolLiquidity = await this.estimatePoolLiquidity(poolAddress);
      const competitionLevel = this.estimateCompetition(recentTxs);

      // Calculate risk score
      let riskScore = 0;

      // Gas price factor (0-25 points)
      if (gasPriceGwei > 100) riskScore += 25;
      else if (gasPriceGwei > 50) riskScore += 15;
      else if (gasPriceGwei > 20) riskScore += 5;

      // Transaction frequency (0-25 points)
      if (txFrequency > 100) riskScore += 25;
      else if (txFrequency > 50) riskScore += 15;
      else if (txFrequency > 20) riskScore += 5;

      // Price volatility (0-25 points)
      if (priceVolatility > 0.05) riskScore += 25;
      else if (priceVolatility > 0.02) riskScore += 15;
      else if (priceVolatility > 0.01) riskScore += 5;

      // Pool liquidity (0-15 points) - low liquidity = higher risk
      if (poolLiquidity < 100000) riskScore += 15;
      else if (poolLiquidity < 1000000) riskScore += 10;
      else if (poolLiquidity < 10000000) riskScore += 5;

      // Competition level (0-10 points)
      if (competitionLevel > 0.8) riskScore += 10;
      else if (competitionLevel > 0.5) riskScore += 5;

      // Determine risk level
      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      if (riskScore >= 80) riskLevel = 'critical';
      else if (riskScore >= 60) riskLevel = 'high';
      else if (riskScore >= 40) riskLevel = 'medium';
      else riskLevel = 'low';

      // Generate recommendation
      const recommendation = this.getRecommendation(
        riskLevel,
        gasPriceGwei,
        expectedProfit,
        borrowAmount
      );

      return {
        riskLevel,
        riskScore: Math.min(100, riskScore),
        factors: {
          gasPrice: gasPriceGwei,
          txFrequency,
          priceVolatility,
          poolLiquidity,
          competitionLevel,
        },
        recommendation,
      };
    } catch (error) {
      console.error('[MEV] Risk assessment failed:', error);
      return {
        riskLevel: 'high',
        riskScore: 75,
        factors: {
          gasPrice: 0,
          txFrequency: 0,
          priceVolatility: 0,
          poolLiquidity: 0,
          competitionLevel: 0,
        },
        recommendation: 'Unable to assess risk, recommend using Flashbots',
      };
    }
  }

  /**
   * Get recent transactions on a pool
   */
  private async getRecentPoolTransactions(poolAddress: string): Promise<any[]> {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      const filter = {
        address: poolAddress.toLowerCase(),
        fromBlock: Math.max(0, blockNumber - 100),
        toBlock: 'latest',
      };

      const logs = await this.provider.getLogs(filter);

      // Cache results
      this.txHistory.set(poolAddress.toLowerCase(), logs);

      return logs;
    } catch (error) {
      console.error('[MEV] Failed to get recent transactions:', error);
      return [];
    }
  }

  /**
   * Calculate price volatility from recent transactions
   */
  private calculateVolatility(txs: any[]): number {
    if (txs.length < 2) return 0;

    // Simplified volatility calculation
    // In production, would calculate actual price changes
    const volatility = Math.random() * 0.1; // Placeholder

    return volatility;
  }

  /**
   * Estimate pool liquidity
   */
  private async estimatePoolLiquidity(poolAddress: string): Promise<number> {
    try {
      // In production, would fetch actual pool reserves
      // For now, return placeholder
      return Math.random() * 10000000;
    } catch (error) {
      return 1000000;
    }
  }

  /**
   * Estimate competition level (0-1)
   * Based on number of recent transactions and MEV activity
   */
  private estimateCompetition(txs: any[]): number {
    // More transactions = more competition
    if (txs.length > 100) return 1;
    if (txs.length > 50) return 0.8;
    if (txs.length > 20) return 0.5;
    return 0.2;
  }

  /**
   * Get recommendation based on risk assessment
   */
  private getRecommendation(
    riskLevel: string,
    gasPrice: number,
    expectedProfit: bigint,
    borrowAmount: bigint
  ): string {
    const profitPercent = Number((expectedProfit * BigInt(10000)) / borrowAmount) / 100;

    if (riskLevel === 'critical') {
      if (profitPercent < 0.5) {
        return 'SKIP: Risk too high for profit margin';
      }
      return 'USE FLASHBOTS: Critical MEV risk, use private mempool';
    }

    if (riskLevel === 'high') {
      if (profitPercent < 0.3) {
        return 'SKIP: High risk with low profit margin';
      }
      return 'FLASHBOTS RECOMMENDED: High MEV activity detected';
    }

    if (riskLevel === 'medium') {
      if (gasPrice > 100) {
        return 'WAIT: High gas prices, wait for lower gas';
      }
      return 'EXECUTE: Medium risk acceptable for profit margin';
    }

    return 'EXECUTE: Low risk, safe to execute';
  }

  /**
   * Detect sandwich attack patterns
   */
  async detectSandwichRisk(
    poolAddress: string,
    swapAmount: bigint
  ): Promise<{
    isSandwichTarget: boolean;
    confidence: number;
    reason: string;
  }> {
    try {
      const recentTxs = await this.getRecentPoolTransactions(poolAddress);

      if (recentTxs.length < 3) {
        return {
          isSandwichTarget: false,
          confidence: 0,
          reason: 'Not enough transaction history',
        };
      }

      // Check for patterns:
      // 1. Large swaps followed by opposite swaps
      // 2. High frequency of trades
      // 3. Transactions from same address

      let sandwichScore = 0;

      // Check for high frequency
      if (recentTxs.length > 50) sandwichScore += 30;
      else if (recentTxs.length > 20) sandwichScore += 15;

      // Check for large swaps (would need to decode amounts)
      // This is simplified
      sandwichScore += 20;

      const isSandwichTarget = sandwichScore > 50;
      const confidence = Math.min(100, sandwichScore);

      return {
        isSandwichTarget,
        confidence,
        reason: isSandwichTarget
          ? 'High sandwich attack risk detected'
          : 'Low sandwich attack risk',
      };
    } catch (error) {
      return {
        isSandwichTarget: true,
        confidence: 50,
        reason: 'Unable to assess sandwich risk',
      };
    }
  }

  /**
   * Get MEV statistics
   */
  getStats() {
    return {
      poolsTracked: this.txHistory.size,
      totalTxsInHistory: Array.from(this.txHistory.values()).reduce((sum, txs) => sum + txs.length, 0),
    };
  }
}
