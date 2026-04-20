/**
 * Risk Manager
 * 
 * Enforces position sizing, stop-loss, drawdown limits, and capital preservation.
 * Prevents catastrophic losses and ensures sustainable profitability.
 */

interface RiskConfig {
  maxPositionSize: bigint;
  maxDailyLoss: number; // USD
  maxDrawdown: number; // Percentage (0-1)
  maxGasPrice: number; // GWEI
  minProfitMargin: number; // Percentage
  maxOpenPositions: number;
  stopLossPercent: number; // Percentage
}

interface PositionTracker {
  id: string;
  entryPrice: number;
  positionSize: bigint;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
}

interface DailyStats {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  maxDrawdown: number;
  startingBalance: bigint;
  endingBalance: bigint;
}

export class RiskManager {
  private config: RiskConfig;
  private dailyStats: DailyStats | null = null;
  private positions: Map<string, PositionTracker> = new Map();
  private startingBalance: bigint;
  private currentBalance: bigint;
  private peakBalance: bigint;

  constructor(
    startingBalance: bigint,
    config: Partial<RiskConfig> = {}
  ) {
    this.startingBalance = startingBalance;
    this.currentBalance = startingBalance;
    this.peakBalance = startingBalance;

    this.config = {
      maxPositionSize: config.maxPositionSize || startingBalance / BigInt(10), // 10% of balance
      maxDailyLoss: config.maxDailyLoss || 1000, // $1000
      maxDrawdown: config.maxDrawdown || 0.2, // 20%
      maxGasPrice: config.maxGasPrice || 100, // GWEI
      minProfitMargin: config.minProfitMargin || 0.1, // 0.1%
      maxOpenPositions: config.maxOpenPositions || 5,
      stopLossPercent: config.stopLossPercent || 2, // 2%
    };

    this.initializeDailyStats();
  }

  /**
   * Check if trade is allowed
   */
  canExecuteTrade(
    positionSize: bigint,
    expectedProfit: bigint,
    gasPrice: number,
    priceUSD: number
  ): {
    allowed: boolean;
    reason: string;
  } {
    // Check position size limit
    if (positionSize > this.config.maxPositionSize) {
      return {
        allowed: false,
        reason: `Position size ${positionSize} exceeds max ${this.config.maxPositionSize}`,
      };
    }

    // Check daily loss limit
    const dailyLoss = this.dailyStats?.totalLoss || 0;
    if (dailyLoss >= this.config.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: $${dailyLoss.toFixed(2)}`,
      };
    }

    // Check drawdown limit
    const drawdown = Number((this.peakBalance - this.currentBalance) * BigInt(10000)) / Number(this.peakBalance) / 100;
    if (drawdown > this.config.maxDrawdown) {
      return {
        allowed: false,
        reason: `Drawdown ${(drawdown * 100).toFixed(2)}% exceeds max ${(this.config.maxDrawdown * 100).toFixed(2)}%`,
      };
    }

    // Check gas price
    if (gasPrice > this.config.maxGasPrice) {
      return {
        allowed: false,
        reason: `Gas price ${gasPrice} GWEI exceeds max ${this.config.maxGasPrice} GWEI`,
      };
    }

    // Check profit margin
    const profitPercent = Number((expectedProfit * BigInt(10000)) / positionSize) / 100;
    if (profitPercent < this.config.minProfitMargin) {
      return {
        allowed: false,
        reason: `Profit margin ${profitPercent.toFixed(2)}% below minimum ${this.config.minProfitMargin}%`,
      };
    }

    // Check open positions limit
    if (this.positions.size >= this.config.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Maximum open positions (${this.config.maxOpenPositions}) reached`,
      };
    }

    return { allowed: true, reason: 'OK' };
  }

  /**
   * Calculate optimal position size based on volatility
   */
  calculateOptimalPositionSize(
    volatility: number, // 0-1
    maxRiskPercent: number = 1 // Risk 1% of balance per trade
  ): bigint {
    // Higher volatility = smaller position
    // Formula: positionSize = maxRisk / volatility
    const volatilityAdjustment = Math.max(0.1, 1 - volatility);
    const riskAmount = (this.currentBalance * BigInt(Math.floor(maxRiskPercent * 100))) / BigInt(10000);
    const optimalSize = (riskAmount * BigInt(Math.floor(volatilityAdjustment * 100))) / BigInt(100);

    return optimalSize > this.config.maxPositionSize ? this.config.maxPositionSize : optimalSize;
  }

  /**
   * Open a position
   */
  openPosition(
    id: string,
    entryPrice: number,
    positionSize: bigint,
    expectedProfit: bigint
  ) {
    const profitPercent = Number((expectedProfit * BigInt(10000)) / positionSize) / 100;
    const stopLoss = entryPrice * (1 - this.config.stopLossPercent / 100);
    const takeProfit = entryPrice * (1 + profitPercent / 100);

    this.positions.set(id, {
      id,
      entryPrice,
      positionSize,
      stopLoss,
      takeProfit,
      timestamp: Date.now(),
    });

    console.log(`[Risk] Opened position ${id}: ${positionSize} at $${entryPrice.toFixed(2)}`);
  }

  /**
   * Close a position
   */
  closePosition(
    id: string,
    exitPrice: number,
    actualProfit: bigint
  ): {
    pnl: number;
    pnlPercent: number;
  } {
    const position = this.positions.get(id);
    if (!position) {
      console.warn(`[Risk] Position ${id} not found`);
      return { pnl: 0, pnlPercent: 0 };
    }

    const pnl = Number(actualProfit);
    const pnlPercent = Number((actualProfit * BigInt(10000)) / position.positionSize) / 100;

    // Update balance
    this.currentBalance += actualProfit;

    // Update peak balance for drawdown calculation
    if (this.currentBalance > this.peakBalance) {
      this.peakBalance = this.currentBalance;
    }

    // Update daily stats
    if (this.dailyStats) {
      this.dailyStats.trades++;
      if (actualProfit > BigInt(0)) {
        this.dailyStats.wins++;
        this.dailyStats.totalProfit += pnl;
      } else {
        this.dailyStats.losses++;
        this.dailyStats.totalLoss += Math.abs(pnl);
      }
      this.dailyStats.netProfit = this.dailyStats.totalProfit - this.dailyStats.totalLoss;
    }

    this.positions.delete(id);

    console.log(`[Risk] Closed position ${id}: P&L $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);

    return { pnl, pnlPercent };
  }

  /**
   * Check if position should be stopped out
   */
  shouldStopOut(id: string, currentPrice: number): boolean {
    const position = this.positions.get(id);
    if (!position) return false;

    // Stop loss triggered
    if (currentPrice <= position.stopLoss) {
      console.log(`[Risk] Stop loss triggered for ${id}: ${currentPrice} <= ${position.stopLoss}`);
      return true;
    }

    // Take profit triggered
    if (currentPrice >= position.takeProfit) {
      console.log(`[Risk] Take profit triggered for ${id}: ${currentPrice} >= ${position.takeProfit}`);
      return true;
    }

    return false;
  }

  /**
   * Get current portfolio metrics
   */
  getPortfolioMetrics() {
    const drawdown = Number((this.peakBalance - this.currentBalance) * BigInt(10000)) / Number(this.peakBalance) / 100;
    const roi = Number((this.currentBalance - this.startingBalance) * BigInt(10000)) / Number(this.startingBalance) / 100;

    return {
      startingBalance: this.startingBalance.toString(),
      currentBalance: this.currentBalance.toString(),
      peakBalance: this.peakBalance.toString(),
      totalProfit: (this.currentBalance - this.startingBalance).toString(),
      roi: roi.toFixed(2) + '%',
      drawdown: (drawdown * 100).toFixed(2) + '%',
      openPositions: this.positions.size,
    };
  }

  /**
   * Get daily statistics
   */
  getDailyStats() {
    return this.dailyStats;
  }

  /**
   * Reset daily statistics (call at end of day)
   */
  resetDailyStats() {
    this.initializeDailyStats();
  }

  /**
   * Initialize daily statistics
   */
  private initializeDailyStats() {
    const today = new Date().toISOString().split('T')[0];

    this.dailyStats = {
      date: today,
      trades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalLoss: 0,
      netProfit: 0,
      maxDrawdown: 0,
      startingBalance: this.currentBalance,
      endingBalance: this.currentBalance,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskConfig>) {
    this.config = { ...this.config, ...config };
    console.log('[Risk] Configuration updated:', this.config);
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }
}
