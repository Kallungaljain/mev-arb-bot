import { ethers, Contract, WebSocketProvider, EventLog } from 'ethers';

/**
 * Real Pool Monitor
 * - Connect to Alchemy WebSocket
 * - Monitor real Polygon pools
 * - Track pool state changes
 * - Detect arbitrage opportunities in real-time
 */

// Uniswap V3 Pool ABI (minimal)
const POOL_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  'event Mint(address indexed sender, address indexed owner, int24 indexed tickLower, int24 tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'function getState() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
];

interface PoolState {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  timestamp: number;
}

interface SwapEvent {
  poolAddress: string;
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  blockNumber: number;
  txHash: string;
}

export class RealPoolMonitor {
  private provider: WebSocketProvider | null = null;
  private pools = new Map<string, PoolState>();
  private listeners = new Map<string, Contract>();
  private alchemyKey: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(alchemyKey: string) {
    this.alchemyKey = alchemyKey;
  }

  /**
   * Initialize WebSocket connection
   */
  async initialize(): Promise<void> {
    try {
      const wsUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${this.alchemyKey}`;
      this.provider = new ethers.WebSocketProvider(wsUrl);

      // Setup connection handlers
      this.provider.on('network', (newNetwork, oldNetwork) => {
        if (oldNetwork) {
          console.log('[PoolMonitor] Network changed');
          // Reconnect on network change
          this.reconnect();
        }
      });

      this.provider.on('error', (error) => {
        console.error('[PoolMonitor] Provider error:', error);
        this.reconnect();
      });

      console.log('[PoolMonitor] WebSocket connected');
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('[PoolMonitor] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Add pool to monitor
   */
  async addPool(poolAddress: string): Promise<PoolState> {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }

      if (!ethers.isAddress(poolAddress)) {
        throw new Error('Invalid pool address');
      }

      // Create pool contract
      const poolContract = new Contract(poolAddress, POOL_ABI, this.provider);

      // Get pool state
      const [token0, token1, fee, slot0, liquidity] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.slot0(),
        poolContract.liquidity(),
      ]);

      const poolState: PoolState = {
        address: poolAddress,
        token0,
        token1,
        fee: Number(fee),
        sqrtPriceX96: slot0.sqrtPriceX96,
        tick: slot0.tick,
        liquidity,
        timestamp: Math.floor(Date.now() / 1000),
      };

      this.pools.set(poolAddress.toLowerCase(), poolState);
      this.listeners.set(poolAddress.toLowerCase(), poolContract);

      // Listen to Swap events
      poolContract.on('Swap', (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick, event) => {
        this.handleSwapEvent({
          poolAddress,
          sender,
          recipient,
          amount0,
          amount1,
          sqrtPriceX96,
          liquidity,
          tick,
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
        });
      });

      console.log(`[PoolMonitor] Added pool: ${poolAddress}`);
      console.log(`[PoolMonitor] Token0: ${token0}, Token1: ${token1}, Fee: ${fee}`);

      return poolState;
    } catch (error) {
      console.error('[PoolMonitor] Failed to add pool:', error);
      throw error;
    }
  }

  /**
   * Handle swap event
   */
  private handleSwapEvent(event: SwapEvent): void {
    try {
      // Update pool state
      const poolState = this.pools.get(event.poolAddress.toLowerCase());
      if (poolState) {
        poolState.sqrtPriceX96 = event.sqrtPriceX96;
        poolState.tick = event.tick;
        poolState.liquidity = event.liquidity;
        poolState.timestamp = Math.floor(Date.now() / 1000);
      }

      console.log(`[PoolMonitor] Swap detected in ${event.poolAddress}`);
      console.log(`[PoolMonitor] Amount0: ${ethers.formatEther(event.amount0)}`);
      console.log(`[PoolMonitor] Amount1: ${ethers.formatEther(event.amount1)}`);
      console.log(`[PoolMonitor] Tick: ${event.tick}`);
    } catch (error) {
      console.error('[PoolMonitor] Error handling swap event:', error);
    }
  }

  /**
   * Get pool state
   */
  getPoolState(poolAddress: string): PoolState | undefined {
    return this.pools.get(poolAddress.toLowerCase());
  }

  /**
   * Get all monitored pools
   */
  getAllPools(): PoolState[] {
    return Array.from(this.pools.values());
  }

  /**
   * Remove pool from monitoring
   */
  removePool(poolAddress: string): void {
    const lowerAddress = poolAddress.toLowerCase();
    const listener = this.listeners.get(lowerAddress);
    if (listener) {
      listener.removeAllListeners();
    }
    this.listeners.delete(lowerAddress);
    this.pools.delete(lowerAddress);
    console.log(`[PoolMonitor] Removed pool: ${poolAddress}`);
  }

  /**
   * Get pool price
   */
  getPoolPrice(poolAddress: string): { price: number; tick: number } | null {
    const poolState = this.getPoolState(poolAddress);
    if (!poolState) {
      return null;
    }

    // Calculate price from sqrtPriceX96
    const sqrtPrice = Number(poolState.sqrtPriceX96) / Math.pow(2, 96);
    const price = sqrtPrice * sqrtPrice;

    return {
      price,
      tick: poolState.tick,
    };
  }

  /**
   * Reconnect to WebSocket
   */
  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PoolMonitor] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff

    console.log(`[PoolMonitor] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.initialize().catch((error) => {
        console.error('[PoolMonitor] Reconnection failed:', error);
        this.reconnect();
      });
    }, delay);
  }

  /**
   * Get monitor status
   */
  getStatus(): {
    connected: boolean;
    poolsMonitored: number;
    pools: PoolState[];
  } {
    return {
      connected: this.provider !== null,
      poolsMonitored: this.pools.size,
      pools: Array.from(this.pools.values()),
    };
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    // Remove all listeners
    for (const listener of this.listeners.values()) {
      listener.removeAllListeners();
    }

    this.listeners.clear();
    this.pools.clear();

    if (this.provider) {
      this.provider.destroy();
    }

    console.log('[PoolMonitor] Disconnected');
  }
}

export default RealPoolMonitor;
