/**
 * Event-Driven Pool Monitor
 * Replaces polling with event-based architecture
 * Listens to Uniswap V3 Swap and Mint events via Alchemy WebSocket
 */

import { EventEmitter } from 'events';
import * as ethers from 'ethers';

export interface PoolState {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  timestamp: number;
  blockNumber: number;
}

export interface PoolUpdate {
  pool: PoolState;
  eventType: 'swap' | 'mint' | 'burn';
  txHash: string;
  blockNumber: number;
  timestamp: number;
}

export interface PoolEventData {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  logIndex: number;
  removed: boolean;
}

/**
 * Uniswap V3 Event Signatures
 */
const UNISWAP_V3_EVENTS = {
  // Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  SWAP: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  
  // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
  MINT: '0x7a53080ba414158be7ec69b6e0266b305cc2f02e2f8aecd759a571499633773c',
  
  // Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
  BURN: '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd755b0528a5cb6f0c10c',
};

/**
 * Event-Driven Pool Monitor
 * Listens to pool events and emits updates
 */
export class EventDrivenPoolMonitor extends EventEmitter {
  private provider: ethers.WebSocketProvider;
  private poolAddresses: Set<string> = new Set();
  private poolCache: Map<string, PoolState> = new Map();
  private subscriptionIds: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // 5 seconds

  constructor(private alchemyKey: string) {
    super();
    const wsUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.setupProviderListeners();
  }

  /**
   * Setup provider event listeners
   */
  private setupProviderListeners(): void {
    this.provider.on('error', (error) => {
      console.error('[EventDrivenPoolMonitor] Provider error:', error);
      this.emit('error', error);
      this.attemptReconnect();
    });

    this.provider.on('network', (newNetwork, oldNetwork) => {
      if (oldNetwork) {
        console.log('[EventDrivenPoolMonitor] Network changed:', newNetwork);
        this.emit('networkChange', newNetwork);
      }
    });
  }

  /**
   * Subscribe to pool events
   */
  async subscribeToPoolEvents(poolAddresses: string[]): Promise<void> {
    console.log(`[EventDrivenPoolMonitor] Subscribing to ${poolAddresses.length} pools`);

    // Validate addresses
    for (const address of poolAddresses) {
      if (!ethers.isAddress(address)) {
        throw new Error(`Invalid pool address: ${address}`);
      }
      this.poolAddresses.add(ethers.getAddress(address));
    }

    // Subscribe to Swap events
    this.subscribeToSwapEvents(Array.from(this.poolAddresses));

    // Subscribe to Mint events
    this.subscribeToMintEvents(Array.from(this.poolAddresses));

    // Subscribe to Burn events
    this.subscribeToBurnEvents(Array.from(this.poolAddresses));

    console.log('[EventDrivenPoolMonitor] Event subscriptions active');
  }

  /**
   * Subscribe to Swap events
   */
  private subscribeToSwapEvents(poolAddresses: string[]): void {
    this.provider.on(
      {
        address: poolAddresses,
        topics: [UNISWAP_V3_EVENTS.SWAP],
      },
      (log: PoolEventData) => {
        this.handleSwapEvent(log);
      }
    );
  }

  /**
   * Subscribe to Mint events
   */
  private subscribeToMintEvents(poolAddresses: string[]): void {
    this.provider.on(
      {
        address: poolAddresses,
        topics: [UNISWAP_V3_EVENTS.MINT],
      },
      (log: PoolEventData) => {
        this.handleMintEvent(log);
      }
    );
  }

  /**
   * Subscribe to Burn events
   */
  private subscribeToBurnEvents(poolAddresses: string[]): void {
    this.provider.on(
      {
        address: poolAddresses,
        topics: [UNISWAP_V3_EVENTS.BURN],
      },
      (log: PoolEventData) => {
        this.handleBurnEvent(log);
      }
    );
  }

  /**
   * Handle Swap event
   * Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
   */
  private async handleSwapEvent(log: PoolEventData): Promise<void> {
    try {
      const poolAddress = ethers.getAddress(log.address);

      // Decode event data
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['int256', 'int256', 'uint160', 'uint128', 'int24'],
        log.data
      );

      const sqrtPriceX96 = decoded[2] as bigint;
      const liquidity = decoded[3] as bigint;
      const tick = decoded[4] as number;

      // Update pool cache
      const poolState = await this.getPoolState(poolAddress);
      poolState.sqrtPriceX96 = sqrtPriceX96;
      poolState.liquidity = liquidity;
      poolState.tick = tick;
      poolState.blockNumber = log.blockNumber;
      poolState.timestamp = Math.floor(Date.now() / 1000);

      this.poolCache.set(poolAddress, poolState);

      // Emit event
      this.emit('poolUpdate', {
        pool: poolState,
        eventType: 'swap',
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: poolState.timestamp,
      } as PoolUpdate);
    } catch (error) {
      console.error('[EventDrivenPoolMonitor] Error handling swap event:', error);
    }
  }

  /**
   * Handle Mint event
   * Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
   */
  private async handleMintEvent(log: PoolEventData): Promise<void> {
    try {
      const poolAddress = ethers.getAddress(log.address);

      // Mint increases liquidity
      const poolState = await this.getPoolState(poolAddress);

      // Fetch updated liquidity from contract
      const currentLiquidity = await this.getPoolLiquidity(poolAddress);
      poolState.liquidity = currentLiquidity;
      poolState.blockNumber = log.blockNumber;
      poolState.timestamp = Math.floor(Date.now() / 1000);

      this.poolCache.set(poolAddress, poolState);

      // Emit event
      this.emit('poolUpdate', {
        pool: poolState,
        eventType: 'mint',
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: poolState.timestamp,
      } as PoolUpdate);
    } catch (error) {
      console.error('[EventDrivenPoolMonitor] Error handling mint event:', error);
    }
  }

  /**
   * Handle Burn event
   * Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
   */
  private async handleBurnEvent(log: PoolEventData): Promise<void> {
    try {
      const poolAddress = ethers.getAddress(log.address);

      // Burn decreases liquidity
      const poolState = await this.getPoolState(poolAddress);

      // Fetch updated liquidity from contract
      const currentLiquidity = await this.getPoolLiquidity(poolAddress);
      poolState.liquidity = currentLiquidity;
      poolState.blockNumber = log.blockNumber;
      poolState.timestamp = Math.floor(Date.now() / 1000);

      this.poolCache.set(poolAddress, poolState);

      // Emit event
      this.emit('poolUpdate', {
        pool: poolState,
        eventType: 'burn',
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: poolState.timestamp,
      } as PoolUpdate);
    } catch (error) {
      console.error('[EventDrivenPoolMonitor] Error handling burn event:', error);
    }
  }

  /**
   * Get pool state from cache or fetch from contract
   */
  private async getPoolState(poolAddress: string): Promise<PoolState> {
    // Check cache first
    const cached = this.poolCache.get(poolAddress);
    if (cached) {
      return { ...cached };
    }

    // Fetch from contract
    return await this.fetchPoolState(poolAddress);
  }

  /**
   * Fetch pool state from contract
   */
  private async fetchPoolState(poolAddress: string): Promise<PoolState> {
    const iface = new ethers.Interface([
      'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
      'function liquidity() external view returns (uint128)',
      'function token0() external view returns (address)',
      'function token1() external view returns (address)',
      'function fee() external view returns (uint24)',
    ]);

    try {
      // Batch call to get all pool data
      const [slot0, liquidity, token0, token1, fee] = await Promise.all([
        this.provider.call({
          to: poolAddress,
          data: iface.encodeFunctionData('slot0'),
        }),
        this.provider.call({
          to: poolAddress,
          data: iface.encodeFunctionData('liquidity'),
        }),
        this.provider.call({
          to: poolAddress,
          data: iface.encodeFunctionData('token0'),
        }),
        this.provider.call({
          to: poolAddress,
          data: iface.encodeFunctionData('token1'),
        }),
        this.provider.call({
          to: poolAddress,
          data: iface.encodeFunctionData('fee'),
        }),
      ]);

      const decodedSlot0 = iface.decodeFunctionResult('slot0', slot0);
      const decodedLiquidity = iface.decodeFunctionResult('liquidity', liquidity);
      const decodedToken0 = iface.decodeFunctionResult('token0', token0);
      const decodedToken1 = iface.decodeFunctionResult('token1', token1);
      const decodedFee = iface.decodeFunctionResult('fee', fee);

      const poolState: PoolState = {
        address: ethers.getAddress(poolAddress),
        token0: ethers.getAddress(decodedToken0[0]),
        token1: ethers.getAddress(decodedToken1[0]),
        fee: Number(decodedFee[0]),
        liquidity: decodedLiquidity[0],
        sqrtPriceX96: decodedSlot0[0],
        tick: decodedSlot0[1],
        timestamp: Math.floor(Date.now() / 1000),
        blockNumber: await this.provider.getBlockNumber(),
      };

      this.poolCache.set(poolAddress, poolState);
      return poolState;
    } catch (error) {
      console.error('[EventDrivenPoolMonitor] Error fetching pool state:', error);
      throw error;
    }
  }

  /**
   * Get pool liquidity
   */
  private async getPoolLiquidity(poolAddress: string): Promise<bigint> {
    const iface = new ethers.Interface([
      'function liquidity() external view returns (uint128)',
    ]);

    try {
      const result = await this.provider.call({
        to: poolAddress,
        data: iface.encodeFunctionData('liquidity'),
      });

      const decoded = iface.decodeFunctionResult('liquidity', result);
      return decoded[0];
    } catch (error) {
      console.error('[EventDrivenPoolMonitor] Error fetching liquidity:', error);
      throw error;
    }
  }

  /**
   * Get cached pool state
   */
  getPoolFromCache(poolAddress: string): PoolState | undefined {
    return this.poolCache.get(ethers.getAddress(poolAddress));
  }

  /**
   * Get all cached pools
   */
  getAllCachedPools(): PoolState[] {
    return Array.from(this.poolCache.values());
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.poolCache.clear();
  }

  /**
   * Attempt to reconnect
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[EventDrivenPoolMonitor] Max reconnection attempts reached');
      this.emit('disconnected');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[EventDrivenPoolMonitor] Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));

    try {
      // Recreate provider
      const wsUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${this.alchemyKey}`;
      this.provider = new ethers.WebSocketProvider(wsUrl);
      this.setupProviderListeners();

      // Re-subscribe to events
      await this.subscribeToPoolEvents(Array.from(this.poolAddresses));

      this.reconnectAttempts = 0;
      console.log('[EventDrivenPoolMonitor] Reconnection successful');
      this.emit('reconnected');
    } catch (error) {
      console.error('[EventDrivenPoolMonitor] Reconnection failed:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    console.log('[EventDrivenPoolMonitor] Disconnecting...');
    this.provider.removeAllListeners();
    await this.provider.destroy();
    this.poolCache.clear();
    this.poolAddresses.clear();
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.provider && !this.provider.destroyed;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    poolCount: number;
    memoryUsage: number;
    oldestEntry: number;
    newestEntry: number;
  } {
    const pools = Array.from(this.poolCache.values());
    const timestamps = pools.map((p) => p.timestamp);

    return {
      poolCount: pools.length,
      memoryUsage: JSON.stringify(pools).length,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
    };
  }
}

/**
 * Usage Example
 */
export async function exampleUsage() {
  const monitor = new EventDrivenPoolMonitor(process.env.ALCHEMY_KEY!);

  // Listen to pool updates
  monitor.on('poolUpdate', (update: PoolUpdate) => {
    console.log(`Pool ${update.pool.address} updated via ${update.eventType}`);
    console.log(`Price: ${update.pool.sqrtPriceX96.toString()}`);
    console.log(`Liquidity: ${update.pool.liquidity.toString()}`);
  });

  // Listen to errors
  monitor.on('error', (error) => {
    console.error('Monitor error:', error);
  });

  // Subscribe to pools
  const poolAddresses = [
    '0xE7e2c6d6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e', // Example pool
  ];

  await monitor.subscribeToPoolEvents(poolAddresses);

  // Monitor cache stats
  setInterval(() => {
    const stats = monitor.getCacheStats();
    console.log('Cache stats:', stats);
  }, 10000);
}
