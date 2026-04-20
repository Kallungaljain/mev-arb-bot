/**
 * Pool State Tracker
 * 
 * Maintains real-time pool reserve data for accurate profit simulation.
 * Tracks staleness to ensure we're using current data.
 */

import { Contract, Provider } from 'ethers';

interface PoolState {
  reserve0: bigint;
  reserve1: bigint;
  blockNumber: number;
  timestamp: number;
}

const UNISWAP_V2_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

export class PoolStateTracker {
  private poolStates: Map<string, PoolState> = new Map();
  private updateTimestamps: Map<string, number> = new Map();
  private maxStalenesMs: number;

  constructor(maxStalenesMs: number = 1000) {
    this.maxStalenesMs = maxStalenesMs;
  }

  /**
   * Update pool state from on-chain data
   */
  async updatePoolState(
    poolAddress: string,
    provider: Provider
  ): Promise<PoolState> {
    try {
      const pair = new Contract(poolAddress, UNISWAP_V2_ABI, provider);
      const [reserve0, reserve1] = await pair.getReserves();
      const blockNumber = await provider.getBlockNumber();

      const state: PoolState = {
        reserve0: BigInt(reserve0),
        reserve1: BigInt(reserve1),
        blockNumber,
        timestamp: Date.now(),
      };

      this.poolStates.set(poolAddress.toLowerCase(), state);
      this.updateTimestamps.set(poolAddress.toLowerCase(), Date.now());

      return state;
    } catch (error) {
      console.error(`[PoolTracker] Failed to update ${poolAddress}:`, error);
      throw error;
    }
  }

  /**
   * Update pool state from WebSocket event (faster than RPC call)
   */
  updatePoolStateFromEvent(
    poolAddress: string,
    reserve0: bigint,
    reserve1: bigint,
    blockNumber: number
  ): PoolState {
    const state: PoolState = {
      reserve0,
      reserve1,
      blockNumber,
      timestamp: Date.now(),
    };

    this.poolStates.set(poolAddress.toLowerCase(), state);
    this.updateTimestamps.set(poolAddress.toLowerCase(), Date.now());

    return state;
  }

  /**
   * Get current pool state
   */
  getPoolState(poolAddress: string): PoolState | null {
    return this.poolStates.get(poolAddress.toLowerCase()) || null;
  }

  /**
   * Check if pool state is stale
   */
  isStale(poolAddress: string, maxAgeMs?: number): boolean {
    const timestamp = this.updateTimestamps.get(poolAddress.toLowerCase());
    if (!timestamp) return true;

    const age = Date.now() - timestamp;
    const threshold = maxAgeMs || this.maxStalenesMs;

    return age > threshold;
  }

  /**
   * Get staleness in milliseconds
   */
  getStalenessMs(poolAddress: string): number {
    const timestamp = this.updateTimestamps.get(poolAddress.toLowerCase());
    if (!timestamp) return Infinity;

    return Date.now() - timestamp;
  }

  /**
   * Batch update multiple pools
   */
  async updateMultiplePools(
    poolAddresses: string[],
    provider: Provider
  ): Promise<Map<string, PoolState>> {
    const results = new Map<string, PoolState>();

    // Update in parallel
    const promises = poolAddresses.map(addr =>
      this.updatePoolState(addr, provider)
        .then(state => results.set(addr.toLowerCase(), state))
        .catch(error => {
          console.error(`[PoolTracker] Failed to update ${addr}:`, error);
        })
    );

    await Promise.all(promises);

    return results;
  }

  /**
   * Get all tracked pools
   */
  getAllPools(): Map<string, PoolState> {
    return new Map(this.poolStates);
  }

  /**
   * Clear old pool states
   */
  clearStaleStates(maxAgeMs: number = 60000): number {
    let cleared = 0;

    for (const [poolAddress, timestamp] of this.updateTimestamps) {
      if (Date.now() - timestamp > maxAgeMs) {
        this.poolStates.delete(poolAddress);
        this.updateTimestamps.delete(poolAddress);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Get pool state health report
   */
  getHealthReport(): {
    totalPools: number;
    stalePools: number;
    averageAge: number;
  } {
    const pools = Array.from(this.poolStates.keys());
    const stalePools = pools.filter(p => this.isStale(p)).length;
    const ages = pools.map(p => this.getStalenessMs(p));
    const averageAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;

    return {
      totalPools: pools.length,
      stalePools,
      averageAge: Math.round(averageAge),
    };
  }
}
