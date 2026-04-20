/**
 * Request Deduplication & Memoization
 * 
 * Prevents duplicate RPC calls and caches recent results.
 * Latency: ~1-2ms for cache hits
 */

interface DedupEntry<T> {
  result: T;
  timestamp: number;
  pending: Promise<T> | null;
}

export class RequestDeduplicator {
  private cache = new Map<string, DedupEntry<any>>();
  private ttl: number;

  constructor(ttlMs: number = 500) {
    this.ttl = ttlMs;
  }

  /**
   * Execute with deduplication
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(key);

    if (cached) {
      // If result is fresh, return it
      if (now - cached.timestamp < this.ttl) {
        return cached.result;
      }

      // If request is pending, wait for it
      if (cached.pending) {
        try {
          const result = await cached.pending;
          return result;
        } catch (error) {
          // Fall through to execute new request
        }
      }
    }

    // Execute new request
    const promise = fn();

    // Store pending promise
    this.cache.set(key, {
      result: null,
      timestamp: now,
      pending: promise,
    });

    try {
      const result = await promise;

      // Store result
      this.cache.set(key, {
        result,
        timestamp: now,
        pending: null,
      });

      return result;
    } catch (error) {
      // Remove from cache on error
      this.cache.delete(key);
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats() {
    let totalHits = 0;
    let expiredCount = 0;

    for (const entry of this.cache.values()) {
      if (entry.pending) totalHits++;
      if (Date.now() - entry.timestamp > this.ttl) {
        expiredCount++;
      }
    }

    return {
      cacheSize: this.cache.size,
      pendingRequests: totalHits,
      expiredEntries: expiredCount,
    };
  }
}

/**
 * Specialized deduplicator for pool data
 */
export class PoolDataDeduplicator {
  private dedup: RequestDeduplicator;

  constructor(ttlMs: number = 500) {
    this.dedup = new RequestDeduplicator(ttlMs);
  }

  /**
   * Get reserves with deduplication
   */
  async getReserves(
    poolAddress: string,
    fn: () => Promise<{ reserve0: bigint; reserve1: bigint }>
  ): Promise<{ reserve0: bigint; reserve1: bigint }> {
    const key = `reserves_${poolAddress.toLowerCase()}`;
    return this.dedup.execute(key, fn);
  }

  /**
   * Get price with deduplication
   */
  async getPrice(
    poolAddress: string,
    fn: () => Promise<number>
  ): Promise<number> {
    const key = `price_${poolAddress.toLowerCase()}`;
    return this.dedup.execute(key, fn);
  }

  /**
   * Get gas price with deduplication
   */
  async getGasPrice(
    fn: () => Promise<bigint>
  ): Promise<bigint> {
    const key = 'gasPrice';
    return this.dedup.execute(key, fn);
  }

  /**
   * Get stats
   */
  getStats() {
    return this.dedup.getStats();
  }

  /**
   * Clear cache
   */
  clear() {
    this.dedup.clear();
  }
}

/**
 * Request batching with deduplication
 */
export class SmartBatcher {
  private dedup: RequestDeduplicator;
  private batchQueue: Array<{
    key: string;
    fn: () => Promise<any>;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }> = [];
  private batchSize: number;
  private batchTimeoutMs: number;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(batchSize: number = 50, batchTimeoutMs: number = 50) {
    this.dedup = new RequestDeduplicator(batchTimeoutMs);
    this.batchSize = batchSize;
    this.batchTimeoutMs = batchTimeoutMs;
  }

  /**
   * Queue a request with deduplication
   */
  async request<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    // Try dedup cache first
    try {
      return await this.dedup.execute(key, fn);
    } catch (error) {
      // Fall through to batch
    }

    // Queue for batch
    return new Promise((resolve, reject) => {
      this.batchQueue.push({
        key,
        fn,
        resolve,
        reject,
      });

      // Process batch if full
      if (this.batchQueue.length >= this.batchSize) {
        this.processBatch();
      } else if (!this.timeoutHandle) {
        this.timeoutHandle = setTimeout(() => this.processBatch(), this.batchTimeoutMs);
      }
    });
  }

  /**
   * Process batch
   */
  private async processBatch() {
    if (this.batchQueue.length === 0) return;

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    const batch = this.batchQueue.splice(0, this.batchSize);

    // Execute all in parallel
    const promises = batch.map(item =>
      item
        .fn()
        .then(result => {
          item.resolve(result);
          return result;
        })
        .catch(error => {
          item.reject(error);
          throw error;
        })
    );

    await Promise.allSettled(promises);

    // Process remaining
    if (this.batchQueue.length > 0) {
      this.processBatch();
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.dedup.getStats(),
      queuedRequests: this.batchQueue.length,
    };
  }

  /**
   * Clear cache
   */
  clear() {
    this.dedup.clear();
  }
}
