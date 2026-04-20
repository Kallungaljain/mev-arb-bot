/**
 * Event-Driven Keeper
 * 
 * Replaces polling loop with event-driven architecture.
 * Responds to pool updates in real-time (<100ms latency).
 */

import { Provider, Wallet, Contract, ethers } from 'ethers';
import { WebSocketListener, type SyncEvent } from './websocket-listener';
import { PoolStateTracker } from './pool-state-tracker';
import { ProfitValidator, type Opportunity } from './profit-validator';
import { SlippageCalculator } from './slippage-calculator';

interface DEXPair {
  name: string;
  token0: string;
  token1: string;
  quickswap: string;
  sushiswap: string;
  decimals0: number;
  decimals1: number;
}

interface TradeResult {
  id: string;
  opportunity: Opportunity;
  txHash: string;
  status: 'pending' | 'success' | 'failed';
  profit: bigint;
  gasUsed: bigint;
  timestamp: number;
}

export class EventDrivenKeeper {
  private wsListener: WebSocketListener;
  private poolTracker: PoolStateTracker;
  private profitValidator: ProfitValidator;
  private slippageCalc: SlippageCalculator;
  private provider: Provider;
  private signer: Wallet;
  private dexPairs: DEXPair[];
  private eliteAntContract: Contract;
  private trades: TradeResult[] = [];
  private isRunning = false;
  private lastOpportunitiesDetected: Opportunity[] = [];

  constructor(
    alchemyWsUrl: string,
    provider: Provider,
    signer: Wallet,
    eliteAntAddress: string,
    dexPairs: DEXPair[]
  ) {
    this.wsListener = new WebSocketListener(alchemyWsUrl);
    this.poolTracker = new PoolStateTracker(500); // 500ms staleness threshold
    this.profitValidator = new ProfitValidator(this.poolTracker, BigInt(1000000), 0.1, 500);
    this.slippageCalc = new SlippageCalculator();
    this.provider = provider;
    this.signer = signer;
    this.dexPairs = dexPairs;

    // Initialize contract
    const eliteAntAbi = [
      'function executeArb(address loanToken, uint256 loanAmount, address buyDex, address sellDex, address profitToken, uint256 minProfit)',
    ];
    this.eliteAntContract = new Contract(eliteAntAddress, eliteAntAbi, signer);
  }

  /**
   * Start the event-driven keeper
   */
  async start() {
    console.log('[Keeper] Starting event-driven keeper...');

    try {
      // Connect to WebSocket
      await this.wsListener.connect();

      // Subscribe to all pool Sync events
      for (const pair of this.dexPairs) {
        console.log(`[Keeper] Subscribing to ${pair.name} on QuickSwap and SushiSwap`);
        this.wsListener.subscribeToPairSync(pair.quickswap);
        this.wsListener.subscribeToPairSync(pair.sushiswap);
      }

      // Subscribe to pending transactions
      this.wsListener.subscribeToPendingTransactions();

      // Set up event handlers
      this.wsListener.on('sync', (event: SyncEvent) => this.onPoolUpdate(event));
      this.wsListener.on('pending', (txHash: string) => this.onPendingTx(txHash));
      this.wsListener.on('error', (error: Error) => this.onError(error));
      this.wsListener.on('disconnected', () => this.onDisconnected());

      this.isRunning = true;
      console.log('[Keeper] Event-driven keeper started');
    } catch (error) {
      console.error('[Keeper] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the keeper
   */
  stop() {
    console.log('[Keeper] Stopping keeper...');
    this.isRunning = false;
    this.wsListener.disconnect();
  }

  /**
   * Handle pool update event
   */
  private async onPoolUpdate(event: SyncEvent) {
    try {
      // Update pool state
      this.poolTracker.updatePoolStateFromEvent(
        event.poolAddress,
        event.reserve0,
        event.reserve1,
        event.blockNumber
      );

      // Detect opportunities from this pool update
      const opportunities = this.detectOpportunitiesFromPoolUpdate(event);

      if (opportunities.length === 0) return;

      console.log(`[Keeper] Detected ${opportunities.length} opportunities from pool update`);

      // Validate and execute profitable opportunities
      for (const opp of opportunities) {
        await this.processOpportunity(opp);
      }
    } catch (error) {
      console.error('[Keeper] Error processing pool update:', error);
    }
  }

  /**
   * Handle pending transaction
   */
  private async onPendingTx(txHash: string) {
    try {
      // Get pending transaction details
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) return;

      // Check if it's a DEX swap that might create an arbitrage opportunity
      // This is simplified; real implementation would decode the transaction
      // and check if it creates a profitable arbitrage cycle

      // For now, we just log it
      // console.log(`[Keeper] Pending tx: ${txHash}`);
    } catch (error) {
      // Ignore errors for pending transactions that might not exist
    }
  }

  /**
   * Detect opportunities from a pool update
   */
  private detectOpportunitiesFromPoolUpdate(event: SyncEvent): Opportunity[] {
    const opportunities: Opportunity[] = [];

    // Find which pair was updated
    const updatedPair = this.dexPairs.find(
      p => p.quickswap.toLowerCase() === event.poolAddress || p.sushiswap.toLowerCase() === event.poolAddress
    );

    if (!updatedPair) return [];

    // Determine which DEX was updated
    const updatedDex = updatedPair.quickswap.toLowerCase() === event.poolAddress ? 'quickswap' : 'sushiswap';
    const otherDex = updatedDex === 'quickswap' ? 'sushiswap' : 'quickswap';

    // Get the other pool's state
    const otherPoolAddress = updatedDex === 'quickswap' ? updatedPair.sushiswap : updatedPair.quickswap;
    const otherPoolState = this.poolTracker.getPoolState(otherPoolAddress);

    if (!otherPoolState) return [];

    // Calculate spread
    const updatedPrice = Number(event.reserve1) / Number(event.reserve0);
    const otherPrice = Number(otherPoolState.reserve1) / Number(otherPoolState.reserve0);
    const spread = Math.abs((updatedPrice - otherPrice) / otherPrice) * 100;

    // If spread is significant, create opportunity
    if (spread > 0.3) {
      const opportunity: Opportunity = {
        id: `opp_${Date.now()}_${Math.random()}`,
        pair: updatedPair.name,
        token0: updatedPair.token0,
        token1: updatedPair.token1,
        buyDex: updatedPrice > otherPrice ? otherPoolAddress : event.poolAddress,
        sellDex: updatedPrice > otherPrice ? event.poolAddress : otherPoolAddress,
        borrowAmount: BigInt(1000000), // 1 USDC (6 decimals) - placeholder
        priceUSD: 1, // Placeholder
        spreadPercent: spread,
        timestamp: Date.now(),
      };

      opportunities.push(opportunity);
    }

    return opportunities;
  }

  /**
   * Process and potentially execute an opportunity
   */
  private async processOpportunity(opportunity: Opportunity) {
    try {
      console.log(`[Keeper] Processing opportunity: ${opportunity.pair} (spread: ${opportunity.spreadPercent.toFixed(2)}%)`);

      // Validate profit
      const validation = await this.profitValidator.validateProfit(opportunity, this.provider);

      if (!validation.isValid) {
        console.log(`[Keeper] Opportunity not profitable: ${validation.reason}`);
        return;
      }

      console.log(`[Keeper] Opportunity validated: $${validation.estimatedProfitUSD.toFixed(2)} (confidence: ${validation.confidence}%)`);

      // Execute trade if confidence is high enough
      if (validation.confidence >= 50) {
        await this.executeTrade(opportunity, validation.estimatedProfit);
      } else {
        console.log(`[Keeper] Confidence too low (${validation.confidence}%), skipping execution`);
      }
    } catch (error) {
      console.error('[Keeper] Error processing opportunity:', error);
    }
  }

  /**
   * Execute a trade
   */
  private async executeTrade(opportunity: Opportunity, estimatedProfit: bigint) {
    try {
      console.log(`[Keeper] Executing trade: ${opportunity.pair}`);

      // Build transaction
      const tx = await this.eliteAntContract.executeArb(
        opportunity.token0, // loanToken
        opportunity.borrowAmount,
        opportunity.buyDex,
        opportunity.sellDex,
        opportunity.token1, // profitToken
        estimatedProfit // minProfit
      );

      // Wait for confirmation
      const receipt = await tx.wait();

      const tradeResult: TradeResult = {
        id: opportunity.id,
        opportunity,
        txHash: tx.hash,
        status: receipt?.status === 1 ? 'success' : 'failed',
        profit: estimatedProfit,
        gasUsed: receipt?.gasUsed || BigInt(0),
        timestamp: Date.now(),
      };

      this.trades.push(tradeResult);

      console.log(`[Keeper] Trade ${tradeResult.status}: ${tx.hash}`);
    } catch (error) {
      console.error('[Keeper] Trade execution failed:', error);
    }
  }

  /**
   * Handle WebSocket error
   */
  private onError(error: Error) {
    console.error('[Keeper] WebSocket error:', error);
  }

  /**
   * Handle WebSocket disconnection
   */
  private onDisconnected() {
    console.warn('[Keeper] WebSocket disconnected, will attempt to reconnect...');
  }

  /**
   * Get keeper status
   */
  getStatus() {
    return {
      running: this.isRunning,
      wsStatus: this.wsListener.getStatus(),
      poolsTracked: this.poolTracker.getHealthReport(),
      tradesExecuted: this.trades.length,
      totalProfit: this.trades.reduce((sum, t) => sum + t.profit, BigInt(0)),
      recentTrades: this.trades.slice(-10),
    };
  }

  /**
   * Get recent opportunities
   */
  getRecentOpportunities() {
    return this.lastOpportunitiesDetected.slice(-20);
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit: number = 100) {
    return this.trades.slice(-limit);
  }
}
