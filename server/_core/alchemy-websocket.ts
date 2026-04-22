/**
 * Alchemy WebSocket Configuration
 * Real-time pool monitoring for MEV detection
 */

import { WebSocketProvider } from 'ethers';

interface AlchemyConfig {
  apiKey: string;
  network?: 'polygon-mainnet' | 'polygon-mumbai';
  maxRetries?: number;
  retryDelay?: number;
}

interface PoolUpdate {
  address: string;
  reserve0: string;
  reserve1: string;
  timestamp: number;
}

/**
 * Alchemy WebSocket manager
 */
export class AlchemyWebSocketManager {
  private provider: WebSocketProvider | null = null;
  private apiKey: string;
  private network: string;
  private maxRetries: number;
  private retryDelay: number;
  private reconnectAttempts = 0;
  private listeners: Map<string, (update: PoolUpdate) => void> = new Map();
  private isConnected = false;

  constructor(config: AlchemyConfig) {
    this.apiKey = config.apiKey;
    this.network = config.network || 'polygon-mainnet';
    this.maxRetries = config.maxRetries || 5;
    this.retryDelay = config.retryDelay || 1000;
  }

  /**
   * Connect to Alchemy WebSocket
   */
  async connect(): Promise<void> {
    try {
      const url = this.buildWebSocketUrl();
      console.log(`[Alchemy] Connecting to ${this.network}...`);

      this.provider = new WebSocketProvider(url);

      // Setup event listeners
      this.provider.on('network', (newNetwork, oldNetwork) => {
        if (oldNetwork) {
          console.log(`[Alchemy] Network changed from ${oldNetwork.chainId} to ${newNetwork.chainId}`);
        }
      });

      this.provider.on('error', (error) => {
        console.error('[Alchemy] WebSocket error:', error);
        this.handleDisconnect();
      });

      this.provider.on('debug', (info) => {
        if (info.action === 'response') {
          console.log(`[Alchemy] Response: ${info.result}`);
        }
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('[Alchemy] Connected successfully');
    } catch (error) {
      console.error('[Alchemy] Connection failed:', error);
      this.handleReconnect();
    }
  }

  /**
   * Subscribe to pool updates
   */
  async subscribeToPool(poolAddress: string, callback: (update: PoolUpdate) => void): Promise<void> {
    if (!this.provider) {
      throw new Error('WebSocket not connected');
    }

    try {
      // Store listener
      this.listeners.set(poolAddress, callback);

      // Subscribe to pool events
      const filter = {
        address: poolAddress,
        topics: [
          '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1', // Swap event
        ],
      };

      this.provider.on(filter, (log) => {
        const update: PoolUpdate = {
          address: poolAddress,
          reserve0: '0',
          reserve1: '0',
          timestamp: Date.now(),
        };

        callback(update);
      });

      console.log(`[Alchemy] Subscribed to pool ${poolAddress}`);
    } catch (error) {
      console.error('[Alchemy] Subscription error:', error);
    }
  }

  /**
   * Unsubscribe from pool
   */
  unsubscribeFromPool(poolAddress: string): void {
    this.listeners.delete(poolAddress);
    console.log(`[Alchemy] Unsubscribed from pool ${poolAddress}`);
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    if (!this.provider) {
      throw new Error('WebSocket not connected');
    }

    return await this.provider.getBlockNumber();
  }

  /**
   * Get pool reserves
   */
  async getPoolReserves(
    poolAddress: string
  ): Promise<{
    reserve0: string;
    reserve1: string;
  }> {
    if (!this.provider) {
      throw new Error('WebSocket not connected');
    }

    try {
      const code = await this.provider.getCode(poolAddress);
      if (code === '0x') {
        throw new Error('Pool address is not a contract');
      }

      // Simplified: return mock data
      // In production, call getReserves() on pool contract
      return {
        reserve0: '1000000000000000000',
        reserve1: '1850000000000000000',
      };
    } catch (error) {
      console.error('[Alchemy] Error getting reserves:', error);
      throw error;
    }
  }

  /**
   * Disconnect WebSocket
   */
  async disconnect(): Promise<void> {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
      this.isConnected = false;
      console.log('[Alchemy] Disconnected');
    }
  }

  /**
   * Check connection status
   */
  getStatus(): {
    connected: boolean;
    network: string;
    listeners: number;
  } {
    return {
      connected: this.isConnected,
      network: this.network,
      listeners: this.listeners.size,
    };
  }

  /**
   * Build WebSocket URL
   */
  private buildWebSocketUrl(): string {
    const baseUrl = 'wss://polygon-mainnet.g.alchemy.com/v2/';
    return `${baseUrl}${this.apiKey}`;
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    console.log('[Alchemy] Disconnected, attempting reconnect...');
    this.handleReconnect();
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxRetries) {
      console.error('[Alchemy] Max reconnection attempts reached');
      return;
    }

    const delay = this.retryDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`[Alchemy] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxRetries})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[Alchemy] Reconnection failed:', error);
        this.handleReconnect();
      });
    }, delay);
  }
}

/**
 * Singleton instance
 */
let alchemyInstance: AlchemyWebSocketManager | null = null;

export function getAlchemyManager(config?: AlchemyConfig): AlchemyWebSocketManager {
  if (!alchemyInstance && config) {
    alchemyInstance = new AlchemyWebSocketManager(config);
  }
  return alchemyInstance!;
}

export function createAlchemyManager(config: AlchemyConfig): AlchemyWebSocketManager {
  return new AlchemyWebSocketManager(config);
}
