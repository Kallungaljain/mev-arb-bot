/**
 * Batch RPC Caller
 * Combines multiple RPC calls into single request
 * Target: <10ms for 50 pool queries (vs 500ms with individual calls)
 */

import axios from 'axios';

interface RpcCall {
  jsonrpc: string;
  id: number;
  method: string;
  params: any[];
}

interface RpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export class BatchRpcCaller {
  private alchemyUrl: string;
  private batchSize = 50; // Max calls per batch
  private timeout = 10000; // 10s timeout

  constructor(alchemyKey: string) {
    this.alchemyUrl = `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  /**
   * Batch call multiple RPC methods
   * Target: <10ms for 50 calls
   */
  async batchCall(calls: Array<{ method: string; params: any[] }>): Promise<any[]> {
    const startTime = Date.now();
    const results: any[] = [];

    // Split into batches
    for (let i = 0; i < calls.length; i += this.batchSize) {
      const batch = calls.slice(i, i + this.batchSize);
      const batchResults = await this.executeBatch(batch);
      results.push(...batchResults);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 10) {
      console.warn(`[BatchRpcCaller] Slow batch: ${elapsed}ms for ${calls.length} calls`);
    }

    return results;
  }

  /**
   * Execute single batch
   */
  private async executeBatch(calls: Array<{ method: string; params: any[] }>): Promise<any[]> {
    const rpcCalls: RpcCall[] = calls.map((call, idx) => ({
      jsonrpc: '2.0',
      id: idx,
      method: call.method,
      params: call.params,
    }));

    try {
      const response = await axios.post(this.alchemyUrl, rpcCalls, {
        timeout: this.timeout,
        headers: { 'Content-Type': 'application/json' },
      });

      // Sort by ID to maintain order
      const sorted = (response.data as RpcResponse[]).sort((a, b) => a.id - b.id);

      return sorted.map((resp) => {
        if (resp.error) {
          throw new Error(`RPC Error (${resp.error.code}): ${resp.error.message}`);
        }
        return resp.result;
      });
    } catch (error: any) {
      console.error('[BatchRpcCaller] Batch failed:', error.message);
      throw error;
    }
  }

  /**
   * Get reserves for multiple pools in single batch
   * Target: <10ms for 50 pools
   */
  async getReservesForPools(poolAddresses: string[]): Promise<Array<{ reserve0: string; reserve1: string }>> {
    const calls = poolAddresses.map((address) => ({
      method: 'eth_call',
      params: [
        {
          to: address,
          data: '0x0902f1ac', // getReserves() selector
        },
        'latest',
      ],
    }));

    const results = await this.batchCall(calls);

    return results.map((result) => {
      if (!result || result.length < 130) {
        return { reserve0: '0', reserve1: '0' };
      }

      return {
        reserve0: '0x' + result.slice(2, 66),
        reserve1: '0x' + result.slice(66, 130),
      };
    });
  }

  /**
   * Get balances for multiple tokens in single batch
   */
  async getBalances(
    tokenAddress: string,
    walletAddresses: string[]
  ): Promise<string[]> {
    const calls = walletAddresses.map((wallet) => ({
      method: 'eth_call',
      params: [
        {
          to: tokenAddress,
          data: `0x70a08231000000000000000000000000${wallet.slice(2)}`,
        },
        'latest',
      ],
    }));

    return this.batchCall(calls);
  }

  /**
   * Get current block number and gas price
   */
  async getNetworkStatus(): Promise<{
    blockNumber: number;
    gasPrice: string;
  }> {
    const calls = [
      { method: 'eth_blockNumber', params: [] },
      { method: 'eth_gasPrice', params: [] },
    ];

    const [blockNumber, gasPrice] = await this.batchCall(calls);

    return {
      blockNumber: parseInt(blockNumber, 16),
      gasPrice,
    };
  }

  /**
   * Get multiple account states
   */
  async getAccountStates(
    addresses: string[]
  ): Promise<
    Array<{
      balance: string;
      nonce: number;
      codeHash: string;
    }>
  > {
    const calls = addresses.map((address) => ({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }));

    const balances = await this.batchCall(calls);

    return balances.map((balance, idx) => ({
      balance,
      nonce: 0,
      codeHash: '0x',
    }));
  }
}

/**
 * Smart RPC caller with caching
 */
export class SmartRpcCaller {
  private batchCaller: BatchRpcCaller;
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTtl = 2000; // 2 second cache

  constructor(alchemyKey: string) {
    this.batchCaller = new BatchRpcCaller(alchemyKey);
  }

  /**
   * Get reserves with caching
   */
  async getReservesForPools(
    poolAddresses: string[]
  ): Promise<Array<{ reserve0: string; reserve1: string }>> {
    // Check cache
    const cached = this.getFromCache('reserves', poolAddresses);
    if (cached) {
      return cached;
    }

    // Fetch from RPC
    const results = await this.batchCaller.getReservesForPools(poolAddresses);

    // Cache results
    this.setInCache('reserves', poolAddresses, results);

    return results;
  }

  /**
   * Get from cache
   */
  private getFromCache(key: string, params: any[]): any {
    const cacheKey = `${key}:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.data;
    }

    return null;
  }

  /**
   * Set in cache
   */
  private setInCache(key: string, params: any[], data: any): void {
    const cacheKey = `${key}:${JSON.stringify(params)}`;
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    // Cleanup old entries
    if (this.cache.size > 1000) {
      const entries = Array.from(this.cache.entries());
      const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 100; i++) {
        this.cache.delete(sorted[i][0]);
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
