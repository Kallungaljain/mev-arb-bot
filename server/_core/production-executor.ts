/**
 * Production Execution Orchestrator
 * Wires all execution components together
 * 
 * Coordinates:
 * - Wallet management
 * - Transaction execution
 * - Flash loans
 * - MEV protection
 * - Error recovery
 * - P&L tracking
 */

import { ProductionWalletManager } from './production-wallet-manager';
import { ProductionTransactionExecutor } from './production-transaction-executor';
import { AaveFlashLoanExecutor } from './aave-flash-loan-executor';
import { MEVProtectionSystem } from './mev-protection-system';
import { CircuitBreaker, HealthMonitor, RetryStrategy } from './production-hardening';
import { FinalUltraLowLatencyEngine } from './final-ultra-low-latency-engine';
import { RealPoolMonitor } from './real-pool-monitor';
import { ethers } from 'ethers';
import type { OpportunityWithRisk } from './ultra-low-latency-engine';

interface ProductionConfig {
  alchemyKey: string;
  tradingPrivateKey?: string;
  profitWithdrawalAddress?: string;
  maxSlippagePercent?: number;
  maxPriceImpact?: number;
  minProfitMargin?: number;
  poolAddresses?: string[];
}

interface ExecutionStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  totalGasSpent: number;
  avgExecutionTime: number;
  successRate: number;
}

/**
 * Production execution orchestrator
 */
export class ProductionExecutor {
  private walletManager: ProductionWalletManager | null = null;
  private transactionExecutor: ProductionTransactionExecutor | null = null;
  private flashLoanExecutor: AaveFlashLoanExecutor | null = null;
  private mevProtection: MEVProtectionSystem | null = null;
  private circuitBreaker: CircuitBreaker;
  private healthMonitor: HealthMonitor;
  private detectionEngine: FinalUltraLowLatencyEngine | null = null;
  private poolMonitor: RealPoolMonitor | null = null;
  private provider: ethers.Provider | null = null;

  private stats: ExecutionStats = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0,
    totalGasSpent: 0,
    avgExecutionTime: 0,
    successRate: 0,
  };

  private executionTimes: number[] = [];
  private isRunning = false;

  constructor(config: ProductionConfig) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000,
    });

    this.healthMonitor = new HealthMonitor();
  }



  /**
   * Initialize executor
   */
  async initialize(config: ProductionConfig): Promise<void> {
    try {
      console.log('[ProductionExecutor] Initializing...');

      // Create provider
      this.provider = new ethers.AlchemyProvider('polygon', config.alchemyKey);

      // Initialize wallet manager
      this.walletManager = new ProductionWalletManager();
      if (config.tradingPrivateKey && config.profitWithdrawalAddress) {
        await this.walletManager.initialize({
          tradingPrivateKey: config.tradingPrivateKey,
          profitAddress: config.profitWithdrawalAddress,
          rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${config.alchemyKey}`,
          alchemyKey: config.alchemyKey,
        });
      }

      // Initialize transaction executor
      this.transactionExecutor = new ProductionTransactionExecutor(
        this.walletManager,
        this.provider as any
      );

      // Initialize flash loan executor
      if (config.tradingPrivateKey && config.profitWithdrawalAddress) {
        const signer = new ethers.Wallet(config.tradingPrivateKey, this.provider);
        this.flashLoanExecutor = new AaveFlashLoanExecutor({
          aavePoolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
          receiverAddress: config.profitWithdrawalAddress,
          provider: this.provider,
          signer: signer,
        });
      }

      // Initialize pool monitor
      this.poolMonitor = new RealPoolMonitor(config.alchemyKey);

      // Initialize MEV protection
      this.mevProtection = new MEVProtectionSystem(
        {
          maxSlippage: Math.round((config.maxSlippagePercent || 0.5) * 100),
          sandwichThreshold: (config.maxPriceImpact || 2) * 100,
        },
        this.provider
      );

      // Initialize detection engine
      this.detectionEngine = new FinalUltraLowLatencyEngine(config.alchemyKey);
      await this.detectionEngine.initialize();

      console.log('[ProductionExecutor] Initialization complete');
      this.healthMonitor.recordRequest(true);
    } catch (error: any) {
      console.error('[ProductionExecutor] Initialization failed:', error.message);
      this.healthMonitor.recordRequest(false, error.message);
      throw error;
    }
  }

  /**
   * Set wallet keys (called from app)
   */
  async setWalletKeys(tradingKey: string, profitAddress: string): Promise<void> {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }

      this.walletManager = new ProductionWalletManager();
      const alchemyKey = (this.provider as any)._apiKey || '';
      await this.walletManager.initialize({
        tradingPrivateKey: tradingKey,
        profitAddress: profitAddress,
        rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        alchemyKey: alchemyKey,
      });

      // Re-initialize flash loan executor with new signer
      const signer = new ethers.Wallet(tradingKey, this.provider);
      this.flashLoanExecutor = new AaveFlashLoanExecutor({
        aavePoolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        receiverAddress: profitAddress,
        provider: this.provider,
        signer: signer,
      });

      console.log('[ProductionExecutor] Wallet keys set');
      this.healthMonitor.recordRequest(true);
    } catch (error: any) {
      console.error('[ProductionExecutor] Failed to set wallet keys:', error.message);
      this.healthMonitor.recordRequest(false, error.message);
      throw error;
    }
  }

  /**
   * Execute opportunity
   */
  async executeOpportunity(opportunity: OpportunityWithRisk): Promise<{
    success: boolean;
    profit: number;
    gasUsed: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      if (!this.circuitBreaker.canExecute()) {
        return {
          success: false,
          profit: 0,
          gasUsed: 0,
          error: 'Circuit breaker is open',
        };
      }

      if (!this.walletManager || !this.transactionExecutor || !this.mevProtection) {
        return {
          success: false,
          profit: 0,
          gasUsed: 0,
          error: 'Components not initialized',
        };
      }

      const result = await RetryStrategy.retryWithBackoff(
        async () => {
          // Validate safety
          const safety = await this.mevProtection!.validateTransactionSafety(
            opportunity.path[0],
            BigInt(opportunity.profitUsd * 1e6),
            BigInt(opportunity.profitUsd * 1e6),
            BigInt(opportunity.profitUsd * 1e6)
          );

          if (!safety.safe) {
            throw new Error(`Trade rejected: ${safety.reasons.join(', ')}`);
          }

          // Build transaction
          const txData = {
            to: opportunity.path[0],
            data: opportunity.calldata || '0x',
            value: '0',
          };

          // Sign transaction
          const signedTx = await this.walletManager!.signTransaction(txData);

          // Execute transaction
          const execResult = await this.transactionExecutor!.executeTransaction(signedTx);

          return {
            success: execResult.success,
            profit: opportunity.profitUsd || 0,
            gasUsed: parseInt(execResult.gasUsed || '0'),
            txHash: execResult.txHash,
          };
        },
        3,
        1000
      );

      const executionTime = Date.now() - startTime;
      this.stats.totalTrades++;
      this.stats.successfulTrades++;
      this.stats.totalProfit += result.profit;
      this.stats.totalGasSpent += result.gasUsed;
      this.executionTimes.push(executionTime);

      if (this.executionTimes.length > 1000) {
        this.executionTimes.shift();
      }

      this.stats.avgExecutionTime =
        this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length;
      this.stats.successRate =
        this.stats.successfulTrades / (this.stats.successfulTrades + this.stats.failedTrades);

      this.circuitBreaker.recordSuccess();
      this.healthMonitor.recordRequest(true);

      return result;
    } catch (error: any) {
      this.stats.totalTrades++;
      this.stats.failedTrades++;
      this.stats.successRate =
        this.stats.successfulTrades / (this.stats.successfulTrades + this.stats.failedTrades);

      this.circuitBreaker.recordFailure();
      this.healthMonitor.recordRequest(false, error.message);

      return {
        success: false,
        profit: 0,
        gasUsed: 0,
        error: error.message,
      };
    }
  }

  /**
   * Start trading loop
   */
  async start(config: ProductionConfig, scanIntervalMs?: number): Promise<void> {
    scanIntervalMs = scanIntervalMs || 1000;
    if (!this.detectionEngine) {
      await this.initialize(config);
    }

    console.log('[ProductionExecutor] Starting trading loop');

    const poolAddresses = config.poolAddresses || [];

    this.isRunning = true;

    while (this.isRunning) {
      try {
        if (!this.circuitBreaker.canExecute()) {
          console.warn('[ProductionExecutor] Circuit breaker is open');
          await new Promise((r) => setTimeout(r, scanIntervalMs! * 2));
          continue;
        }

        const scanResult = await this.detectionEngine!.scan(poolAddresses);

        console.log(
          `[ProductionExecutor] Scan: ${scanResult.opportunitiesFound} opportunities, ${scanResult.opportunitiesExecuted} executed`
        );

        this.circuitBreaker.recordSuccess();
        this.healthMonitor.recordRequest(true);

        await new Promise((r) => setTimeout(r, scanIntervalMs!));
      } catch (error: any) {
        console.error('[ProductionExecutor] Scan failed:', error.message);
        this.circuitBreaker.recordFailure();
        this.healthMonitor.recordRequest(false, error.message);
        await new Promise((r) => setTimeout(r, scanIntervalMs! * 2));
      }
    }
  }

  /**
   * Stop trading loop
   */
  stop(): void {
    this.isRunning = false;
    console.log('[ProductionExecutor] Trading loop stopped');
  }

  /**
   * Check if running
   */
  isRunningNow(): boolean {
    return this.isRunning;
  }

  /**
   * Get statistics
   */
  getStats(): ExecutionStats {
    return { ...this.stats };
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    circuitBreaker: string;
    metrics: any;
  }> {
    return {
      healthy: this.healthMonitor.isHealthy(),
      circuitBreaker: this.circuitBreaker.getState(),
      metrics: this.healthMonitor.getMetrics(),
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.stop();
    if (this.poolMonitor) {
      await this.poolMonitor.disconnect();
    }
    console.log('[ProductionExecutor] Shutdown complete');
  }
}

/**
 * Factory function
 */
export async function createProductionExecutor(config: ProductionConfig): Promise<ProductionExecutor> {
  const executor = new ProductionExecutor(config);
  await executor.initialize(config);
  return executor;
}
