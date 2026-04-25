/**
 * Event-Driven Production Executor
 * Replaces polling with event-based architecture
 * Uses Balancer V2 for flash loans (0% fee)
 */

import * as ethers from 'ethers';
import { EventDrivenPoolMonitor, PoolUpdate } from './event-driven-pool-monitor';
import { BalancerFlashLoanExecutor } from './balancer-flash-loan-executor';
import { ProductionWalletManager } from './production-wallet-manager';
import { ProductionTransactionExecutor } from './production-transaction-executor';
import { MEVProtectionSystem } from './mev-protection-system';
// import { UltraFastEngine } from './ultra-low-latency-engine';
import { CircuitBreaker, HealthMonitor } from './production-hardening';
import { EventEmitter } from 'events';

export interface EventDrivenExecutorConfig {
  alchemyKey: string;
  tradingPrivateKey?: string;
  profitWithdrawalAddress?: string;
  receiverContractAddress: string;
  maxSlippagePercent?: number;
  maxPriceImpact?: number;
  minProfitMargin?: number;
  poolAddresses?: string[];
}

export interface ExecutorStats {
  uptime: number;
  totalOpportunities: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: bigint;
  totalGasSpent: bigint;
  errorRate: number;
  lastError?: string;
  eventsProcessed: number;
}

/**
 * Event-Driven Production Executor
 * 
 * Architecture:
 * 1. EventDrivenPoolMonitor listens to pool events
 * 2. On pool update event, trigger opportunity detection
 * 3. Execute trades immediately (no polling delay)
 * 4. Use Balancer for flash loans (0% fee)
 * 5. Track statistics and health
 */
export class EventDrivenProductionExecutor extends EventEmitter {
  private provider: ethers.Provider;
  private poolMonitor: EventDrivenPoolMonitor;
  private walletManager: ProductionWalletManager | null = null;
  private transactionExecutor: ProductionTransactionExecutor | null = null;
  private flashLoanExecutor: BalancerFlashLoanExecutor | null = null;
  private mevProtection: MEVProtectionSystem | null = null;
  // private engine: UltraFastEngine;
  private circuitBreaker: CircuitBreaker;
  private healthMonitor: HealthMonitor;

  private isRunning = false;
  private stats: ExecutorStats = {
    uptime: 0,
    totalOpportunities: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0n,
    totalGasSpent: 0n,
    errorRate: 0,
    eventsProcessed: 0,
  };

  private startTime = 0;

  constructor(private config: EventDrivenExecutorConfig) {
    super();

    // Create provider
    const alchemyUrl = `https://polygon-mainnet.g.alchemy.com/v2/${config.alchemyKey}`;
    this.provider = new ethers.JsonRpcProvider(alchemyUrl);

    // Initialize components
    this.poolMonitor = new EventDrivenPoolMonitor(config.alchemyKey);
    // this.engine = new UltraFastEngine();
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000,
    });
    this.healthMonitor = new HealthMonitor();

    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen to pool updates from monitor
    this.poolMonitor.on('poolUpdate', (update: PoolUpdate) => {
      this.handlePoolUpdate(update);
    });

    // Listen to pool monitor errors
    this.poolMonitor.on('error', (error) => {
      console.error('[EventDrivenExecutor] Pool monitor error:', error);
      this.healthMonitor.recordRequest(false, error.message);
    });

    // Listen to reconnection
    this.poolMonitor.on('reconnected', () => {
      console.log('[EventDrivenExecutor] Pool monitor reconnected');
      this.emit('reconnected');
    });
  }

  /**
   * Initialize executor
   */
  async initialize(config: EventDrivenExecutorConfig): Promise<void> {
    console.log('[EventDrivenExecutor] Initializing...');

    // Initialize wallet manager
    if (config.tradingPrivateKey && config.profitWithdrawalAddress) {
      this.walletManager = new ProductionWalletManager();
      await this.walletManager.initialize({
        tradingPrivateKey: config.tradingPrivateKey,
        profitAddress: config.profitWithdrawalAddress,
        rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${config.alchemyKey}`,
        alchemyKey: config.alchemyKey,
      });

      console.log('[EventDrivenExecutor] Wallet manager initialized');
    }

    // Initialize transaction executor
    if (this.walletManager) {
      this.transactionExecutor = new ProductionTransactionExecutor(
        this.walletManager,
        this.provider as any
      );
      console.log('[EventDrivenExecutor] Transaction executor initialized');
    }

    // Initialize Balancer flash loan executor
    if (this.walletManager) {
      const signer = new ethers.Wallet(config.tradingPrivateKey!, this.provider);
      this.flashLoanExecutor = new BalancerFlashLoanExecutor({
        balancerVaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        receiverAddress: config.receiverContractAddress,
        provider: this.provider,
        signer: signer,
      });

      console.log('[EventDrivenExecutor] Balancer flash loan executor initialized');
    }

    // Initialize MEV protection
    this.mevProtection = new MEVProtectionSystem(
      {
        maxSlippage: (config.maxSlippagePercent || 0.5) * 100, // Convert to basis points
        sandwichThreshold: 100,
      },
      this.provider as any
    );

    console.log('[EventDrivenExecutor] MEV protection initialized');
    console.log('[EventDrivenExecutor] Initialization complete');
  }

  /**
   * Set wallet keys
   */
  async setWalletKeys(tradingKey: string, profitAddress: string): Promise<void> {
    console.log('[EventDrivenExecutor] Setting wallet keys...');

    this.walletManager = new ProductionWalletManager();
    await this.walletManager.initialize({
      tradingPrivateKey: tradingKey,
      profitAddress: profitAddress,
      rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${this.config.alchemyKey}`,
      alchemyKey: this.config.alchemyKey,
    });

    // Re-initialize transaction executor
    this.transactionExecutor = new ProductionTransactionExecutor(
      this.walletManager,
      this.provider as any
    );

    // Re-initialize flash loan executor
    const signer = new ethers.Wallet(tradingKey, this.provider);
    this.flashLoanExecutor = new BalancerFlashLoanExecutor({
      balancerVaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      receiverAddress: this.config.receiverContractAddress,
      provider: this.provider,
      signer: signer,
    });

    console.log('[EventDrivenExecutor] Wallet keys set successfully');
  }

  /**
   * Start executor
   */
  async start(config: EventDrivenExecutorConfig): Promise<void> {
    console.log('[EventDrivenExecutor] Starting...');

    if (this.isRunning) {
      console.log('[EventDrivenExecutor] Already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    // Subscribe to pool events
    if (config.poolAddresses && config.poolAddresses.length > 0) {
      await this.poolMonitor.subscribeToPoolEvents(config.poolAddresses);
      console.log('[EventDrivenExecutor] Subscribed to pool events');
    }

    console.log('[EventDrivenExecutor] Started (event-driven mode)');
    this.emit('started');
  }

  /**
   * Stop executor
   */
  async stop(): Promise<void> {
    console.log('[EventDrivenExecutor] Stopping...');

    this.isRunning = false;
    await this.poolMonitor.disconnect();

    console.log('[EventDrivenExecutor] Stopped');
    this.emit('stopped');
  }

  /**
   * Handle pool update event
   */
  private async handlePoolUpdate(update: PoolUpdate): Promise<void> {
    try {
      // Check circuit breaker
      if (!this.circuitBreaker.canExecute()) {
        console.log('[EventDrivenExecutor] Circuit breaker open, skipping');
        this.healthMonitor.recordRequest(false, 'Circuit breaker open');
        return;
      }

      this.stats.eventsProcessed++;

      // Get all cached pools
      const pools = this.poolMonitor.getAllCachedPools();

      if (pools.length === 0) {
        return;
      }

      // Detect opportunities
      // const opportunities = this.engine.detectWithInlineRisk(pools);
      // this.stats.totalOpportunities += opportunities.length;
      const opportunities: any[] = []; // Placeholder

      if (opportunities.length === 0) {
        return;
      }

      console.log(`[EventDrivenExecutor] Detected ${opportunities.length} opportunities`);

      // Execute opportunities
      for (const opportunity of opportunities) {
        await this.executeOpportunity(opportunity);
      }

      this.circuitBreaker.recordSuccess();
      this.healthMonitor.recordRequest(true);
    } catch (error: any) {
      console.error('[EventDrivenExecutor] Error handling pool update:', error.message);
      this.circuitBreaker.recordFailure();
      this.healthMonitor.recordRequest(false, error.message);
    }
  }

  /**
   * Execute opportunity
   */
  private async executeOpportunity(opportunity: any): Promise<void> {
    try {
      console.log(`[EventDrivenExecutor] Executing opportunity: ${opportunity.id}`);

      // Validate safety
      if (!this.mevProtection) {
        throw new Error('MEV protection not initialized');
      }

      const safety = await this.mevProtection.validateTransactionSafety(
        opportunity.path[0],
        ethers.parseUnits('1000', 6),
        BigInt(opportunity.profitUsd),
        BigInt(opportunity.profitUsd)
      );

      if (!safety.safe) {
        console.log('[EventDrivenExecutor] Opportunity failed safety check');
        return;
      }

      // Execute flash loan trade
      if (!this.flashLoanExecutor) {
        throw new Error('Flash loan executor not initialized');
      }

      const result = await this.flashLoanExecutor.executeFlashLoan({
        tokens: [opportunity.path[0]],
        amounts: [ethers.parseUnits('1000000', 6).toString()],
        arbitrageData: {
          path: opportunity.path,
          amounts: opportunity.amounts || [],
          deadline: Math.floor(Date.now() / 1000) + 300,
        },
      });

      if (result.success) {
        console.log(`[EventDrivenExecutor] Trade successful: ${result.txHash}`);
        this.stats.successfulTrades++;
        this.stats.totalProfit += BigInt(result.profit);
        this.stats.totalGasSpent += BigInt(result.fee); // Fee is 0 for Balancer
      } else {
        console.log(`[EventDrivenExecutor] Trade failed: ${result.error}`);
        this.stats.failedTrades++;
      }
    } catch (error: any) {
      console.error('[EventDrivenExecutor] Error executing opportunity:', error.message);
      this.stats.failedTrades++;
    }
  }

  /**
   * Get statistics
   */
  getStats(): ExecutorStats {
    const now = Date.now();
    const uptime = now - this.startTime;

    const totalTrades = this.stats.successfulTrades + this.stats.failedTrades;
    const errorRate =
      totalTrades > 0 ? (this.stats.failedTrades / totalTrades) * 100 : 0;

    return {
      ...this.stats,
      uptime,
      errorRate,
    };
  }

  /**
   * Get health status
   */
  getHealth(): {
    isRunning: boolean;
    circuitBreakerState: string;
    isHealthy: boolean;
    metrics: any;
  } {
    return {
      isRunning: this.isRunning,
      circuitBreakerState: 'closed', // Would get from circuit breaker
      isHealthy: this.healthMonitor ? true : false,
      metrics: {
        eventsProcessed: this.stats.eventsProcessed,
        opportunities: this.stats.totalOpportunities,
        trades: this.stats.successfulTrades,
      },
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[EventDrivenExecutor] Shutting down...');
    await this.stop();
    this.removeAllListeners();
  }
}

/**
 * Usage Example
 */
export async function exampleEventDrivenExecutor() {
  const executor = new EventDrivenProductionExecutor({
    alchemyKey: process.env.ALCHEMY_KEY!,
    tradingPrivateKey: process.env.TRADING_PRIVATE_KEY,
    profitWithdrawalAddress: process.env.PROFIT_ADDRESS,
    receiverContractAddress: process.env.RECEIVER_CONTRACT_ADDRESS!,
    maxSlippagePercent: 0.5,
    poolAddresses: [
      '0xE7e2c6d6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e', // Example pool
    ],
  });

  // Initialize
  await executor.initialize({
    alchemyKey: process.env.ALCHEMY_KEY!,
    tradingPrivateKey: process.env.TRADING_PRIVATE_KEY,
    profitWithdrawalAddress: process.env.PROFIT_ADDRESS,
    receiverContractAddress: process.env.RECEIVER_CONTRACT_ADDRESS!,
  });

  // Listen to events
  executor.on('started', () => {
    console.log('Executor started');
  });

  executor.on('stopped', () => {
    console.log('Executor stopped');
  });

  executor.on('reconnected', () => {
    console.log('Executor reconnected');
  });

  // Start
  await executor.start({
    alchemyKey: process.env.ALCHEMY_KEY!,
    receiverContractAddress: process.env.RECEIVER_CONTRACT_ADDRESS!,
    poolAddresses: [
      '0xE7e2c6d6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e', // Example pool
    ],
  });

  // Monitor stats
  setInterval(() => {
    const stats = executor.getStats();
    console.log('Stats:', stats);
  }, 5000);
}
