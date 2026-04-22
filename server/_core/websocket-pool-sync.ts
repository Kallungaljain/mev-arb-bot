/**
 * WebSocket Pool Synchronization
 * Real-time pool updates via Alchemy WebSocket
 * Eliminates RPC latency by pushing updates instead of polling
 * 
 * Target: <5ms pool update latency
 */

import type { PoolState } from './types';

interface PoolUpdate {
  address: string;
  token0: string;
  token1: string;
  reserve0: number;
  reserve1: number;
  fee: number;
  timestamp: number;
}

interface SubscriptionMetrics {
  poolsSubscribed: number;
  updatesReceived: number;
  avgUpdateLatency: number;
  lastUpdateAt: number;
}

/**
 * WebSocket-based pool synchronizer
 * Subscribes to pool events and maintains in-memory cache
 */
export class WebSocketPoolSync {
  private ws: WebSocket | null = null;
  private pools = new Map<string, PoolState>();
  private updateTimes: number[] = [];
  private metrics: SubscriptionMetrics = {
    poolsSubscribed: 0,
    updatesReceived: 0,
    avgUpdateLatency: 0,
    lastUpdateAt: 0,
  };
  private alchemyUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(alchemyKey: string) {
    // Convert HTTP URL to WebSocket URL
    this.alchemyUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  /**
   * Connect to WebSocket and start listening for pool updates
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.alchemyUrl);

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected to Alchemy');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handlePoolUpdate(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WebSocket] Disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Subscribe to pool updates
   */
  subscribeToPool(poolAddress: string, tokens: [string, string]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Not connected, cannot subscribe');
      return;
    }

    const subscription = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_subscribe',
      params: [
        'logs',
        {
          address: poolAddress,
          topics: [
            '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67', // Swap event
          ],
        },
      ],
    };

    this.ws.send(JSON.stringify(subscription));
    this.metrics.poolsSubscribed++;
  }

  /**
   * Handle incoming pool update
   */
  private handlePoolUpdate(data: string): void {
    const startTime = Date.now();

    try {
      const message = JSON.parse(data);

      // Skip subscription confirmations
      if (message.result) {
        return;
      }

      // Process pool update
      if (message.params?.result?.logs) {
        const log = message.params.result.logs[0];
        if (!log) return;

        // Extract pool data from log
        const poolUpdate = this.parsePoolUpdate(log);
        if (poolUpdate) {
          this.pools.set(poolUpdate.address, {
            address: poolUpdate.address,
            token0: poolUpdate.token0,
            token1: poolUpdate.token1,
            reserve0: poolUpdate.reserve0,
            reserve1: poolUpdate.reserve1,
            fee: poolUpdate.fee,
          });

          // Track latency
          const updateLatency = Date.now() - startTime;
          this.updateTimes.push(updateLatency);
          if (this.updateTimes.length > 1000) {
            this.updateTimes.shift();
          }

          this.metrics.updatesReceived++;
          this.metrics.avgUpdateLatency =
            this.updateTimes.reduce((a, b) => a + b, 0) / this.updateTimes.length;
          this.metrics.lastUpdateAt = Date.now();
        }
      }
    } catch (error) {
      console.error('[WebSocket] Parse error:', error);
    }
  }

  /**
   * Parse pool update from log
   */
  private parsePoolUpdate(log: any): PoolUpdate | null {
    try {
      // Extract reserves from log data
      // This is simplified - real implementation would decode ABI
      const data = log.data;
      if (!data || data.length < 130) return null;

      // Parse hex data
      const reserve0 = parseInt(data.slice(2, 66), 16);
      const reserve1 = parseInt(data.slice(66, 130), 16);

      return {
        address: log.address,
        token0: '0x' + log.topics[1]?.slice(-40),
        token1: '0x' + log.topics[2]?.slice(-40),
        reserve0: reserve0 / 1e6, // Normalize to decimal
        reserve1: reserve1 / 1e18,
        fee: 0.3, // Default fee
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all cached pools
   */
  getPools(): PoolState[] {
    return Array.from(this.pools.values());
  }

  /**
   * Get specific pool
   */
  getPool(address: string): PoolState | null {
    return this.pools.get(address) || null;
  }

  /**
   * Get metrics
   */
  getMetrics(): SubscriptionMetrics {
    return { ...this.metrics };
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[WebSocket] Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.pools.clear();
    this.updateTimes = [];
  }
}

/**
 * Hybrid pool fetcher: WebSocket + RPC fallback
 */
export class HybridPoolFetcher {
  private wsSync: WebSocketPoolSync;
  private alchemyUrl: string;
  private lastRpcFetch = 0;
  private rpFetchInterval = 5000; // Fallback to RPC every 5s

  constructor(alchemyKey: string) {
    this.wsSync = new WebSocketPoolSync(alchemyKey);
    this.alchemyUrl = `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  /**
   * Initialize WebSocket connection
   */
  async initialize(): Promise<void> {
    try {
      await this.wsSync.connect();
      console.log('[HybridPoolFetcher] WebSocket connected');
    } catch (error) {
      console.warn('[HybridPoolFetcher] WebSocket failed, will use RPC fallback:', error);
    }
  }

  /**
   * Get pools (WebSocket-first, RPC fallback)
   */
  async getPools(poolAddresses: string[]): Promise<PoolState[]> {
    // Try WebSocket first
    const wsPools = this.wsSync.getPools();
    if (wsPools.length > 0) {
      return wsPools;
    }

    // Fallback to RPC if WebSocket has no data
    if (Date.now() - this.lastRpcFetch > this.rpFetchInterval) {
      return this.fetchPoolsViaRpc(poolAddresses);
    }

    return [];
  }

  /**
   * Fetch pools via RPC (fallback)
   */
  private async fetchPoolsViaRpc(poolAddresses: string[]): Promise<PoolState[]> {
    try {
      const pools: PoolState[] = [];

      for (const address of poolAddresses) {
        // Batch RPC call to get reserves
        const response = await fetch(this.alchemyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [
              {
                to: address,
                data: '0x0902f1ac', // getReserves() selector
              },
              'latest',
            ],
          }),
        });

        const data = await response.json();
        if (data.result) {
          pools.push({
            address,
            token0: 'USDC',
            token1: 'WMATIC',
            reserve0: parseInt(data.result.slice(2, 66), 16),
            reserve1: parseInt(data.result.slice(66, 130), 16),
            fee: 0.3,
          });
        }
      }

      this.lastRpcFetch = Date.now();
      return pools;
    } catch (error) {
      console.error('[HybridPoolFetcher] RPC fetch failed:', error);
      return [];
    }
  }

  /**
   * Subscribe to pool
   */
  subscribeToPool(poolAddress: string, tokens: [string, string]): void {
    this.wsSync.subscribeToPool(poolAddress, tokens);
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return this.wsSync.getMetrics();
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    this.wsSync.disconnect();
  }
}
