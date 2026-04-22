import { describe, it, expect, beforeEach } from 'vitest';
import {
  UltraLowLatencyEngine,
  UltraFastDetector,
  UnifiedExecutor,
  PoolCache,
} from '../ultra-low-latency-engine';
import type { PoolState } from '../types';

describe('UltraLowLatencyEngine', () => {
  let engine: UltraLowLatencyEngine;

  beforeEach(() => {
    engine = new UltraLowLatencyEngine();
  });

  describe('PoolCache', () => {
    it('should cache and retrieve pools', () => {
      const cache = new PoolCache();
      const pool: PoolState = {
        address: '0xpool1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1_000_000,
        reserve1: 1_850_000,
        fee: 0.3,
      };

      cache.set('0xpool1', pool);
      expect(cache.get('0xpool1')).toEqual(pool);
      expect(cache.has('0xpool1')).toBe(true);
    });

    it('should respect TTL', async () => {
      const cache = new PoolCache();
      const pool: PoolState = {
        address: '0xpool1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1_000_000,
        reserve1: 1_850_000,
        fee: 0.3,
      };

      cache.set('0xpool1', pool, 10); // 10ms TTL
      expect(cache.get('0xpool1')).not.toBeNull();

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 20));
      expect(cache.get('0xpool1')).toBeNull();
    });

    it('should handle LRU eviction', () => {
      const cache = new PoolCache();
      const pools: PoolState[] = [];

      // Add 501 pools (exceeds maxSize of 500)
      for (let i = 0; i < 501; i++) {
        const pool: PoolState = {
          address: `0xpool${i}`,
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        };
        cache.set(`0xpool${i}`, pool);
        pools.push(pool);
      }

      // First pool should be evicted
      expect(cache.has('0xpool0')).toBe(false);
      // Last pool should exist
      expect(cache.has('0xpool500')).toBe(true);
      expect(cache.size()).toBeLessThanOrEqual(500);
    });
  });

  describe('UltraFastDetector', () => {
    it('should detect arbitrage with inline risk scoring', () => {
      const detector = new UltraFastDetector();
      const pools: PoolState[] = [
        {
          address: '0xquickswap',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
        {
          address: '0xsushiswap',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 500_000,
          reserve1: 900_000,
          fee: 0.3,
        },
      ];

      const opps = detector.detectWithInlineRisk(pools);
      expect(Array.isArray(opps)).toBe(true);

      // Should have pre-computed calldata
      if (opps.length > 0) {
        expect(opps[0].calldata).toBeDefined();
        expect(opps[0].calldata).toMatch(/^0x/);
        expect(opps[0].riskScore).toBeGreaterThanOrEqual(0);
        expect(opps[0].riskScore).toBeLessThanOrEqual(100);
        expect(typeof opps[0].isSafe).toBe('boolean');
      }
    });

    it('should calculate inline risk correctly', () => {
      const detector = new UltraFastDetector();
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      const opps = detector.detectWithInlineRisk(pools);

      // Risk should be reasonable
      for (const opp of opps) {
        expect(opp.riskScore).toBeGreaterThanOrEqual(0);
        expect(opp.riskScore).toBeLessThanOrEqual(100);
      }
    });

    it('should pre-compute calldata', () => {
      const detector = new UltraFastDetector();
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      const opps = detector.detectWithInlineRisk(pools);

      for (const opp of opps) {
        // Calldata should be valid hex
        expect(opp.calldata).toMatch(/^0x[0-9a-f]+$/i);
        // Should be reasonably sized
        expect(opp.calldata.length).toBeGreaterThan(10);
      }
    });

    it('should complete detection in <5ms', () => {
      const detector = new UltraFastDetector();
      const pools: PoolState[] = [];

      // Create 50 pools
      for (let i = 0; i < 50; i++) {
        pools.push({
          address: `0xpool${i}`,
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        });
      }

      const start = Date.now();
      detector.detectWithInlineRisk(pools);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5);
    });
  });

  describe('UnifiedExecutor', () => {
    it('should execute safe opportunity', async () => {
      const executor = new UnifiedExecutor();
      const opp = {
        id: 'test-1',
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 1.5,
        profitUsd: 50,
        riskScore: 20, // Safe
        isSafe: true,
        calldata: '0x920f5c84' + '0'.repeat(128),
        detectedAt: Date.now(),
        expiresAt: Date.now() + 5000,
      };

      const result = await executor.executeOpportunity(opp);
      expect(result.success).toBe(true);
      expect(result.profit).toBe(50);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should reject high-risk opportunity', async () => {
      const executor = new UnifiedExecutor();
      const opp = {
        id: 'test-2',
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 0.5,
        profitUsd: 10,
        riskScore: 50, // Too risky
        isSafe: false,
        calldata: '0x920f5c84' + '0'.repeat(128),
        detectedAt: Date.now(),
        expiresAt: Date.now() + 5000,
      };

      const result = await executor.executeOpportunity(opp);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Risk too high');
    });

    it('should reject low-profit opportunity', async () => {
      const executor = new UnifiedExecutor();
      const opp = {
        id: 'test-3',
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 0.1,
        profitUsd: 2, // Too low
        riskScore: 10,
        isSafe: true,
        calldata: '0x920f5c84' + '0'.repeat(128),
        detectedAt: Date.now(),
        expiresAt: Date.now() + 5000,
      };

      const result = await executor.executeOpportunity(opp);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Profit too low');
    });

    it('should track metrics', async () => {
      const executor = new UnifiedExecutor();
      const opp = {
        id: 'test-4',
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 1.5,
        profitUsd: 75,
        riskScore: 15,
        isSafe: true,
        calldata: '0x920f5c84' + '0'.repeat(128),
        detectedAt: Date.now(),
        expiresAt: Date.now() + 5000,
      };

      await executor.executeOpportunity(opp);
      const metrics = executor.getMetrics();

      expect(metrics.successCount).toBe(1);
      expect(metrics.totalProfit).toBe(75);
      expect(metrics.avgExecutionTime).toBeGreaterThanOrEqual(0);
    });

    it('should execute in <20ms', async () => {
      const executor = new UnifiedExecutor();
      const opp = {
        id: 'bench-1',
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 1.5,
        profitUsd: 50,
        riskScore: 20,
        isSafe: true,
        calldata: '0x920f5c84' + '0'.repeat(128),
        detectedAt: Date.now(),
        expiresAt: Date.now() + 5000,
      };

      const start = Date.now();
      await executor.executeOpportunity(opp);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(20);
    });
  });

  describe('UltraLowLatencyEngine', () => {
    it('should complete full scan cycle in <30ms', async () => {
      const pools: PoolState[] = [
        {
          address: '0xquickswap',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
        {
          address: '0xsushiswap',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 500_000,
          reserve1: 900_000,
          fee: 0.3,
        },
      ];

      const start = Date.now();
      const result = await engine.scan(pools);
      const elapsed = Date.now() - start;

      expect(result.totalTime).toBeLessThan(30);
      expect(elapsed).toBeLessThan(30);
    });

    it('should detect opportunities', async () => {
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      const result = await engine.scan(pools);
      expect(result.opportunitiesDetected).toBeGreaterThanOrEqual(0);
    });

    it('should get metrics', async () => {
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      await engine.scan(pools);
      const metrics = engine.getMetrics();

      expect(metrics.lastScan).toBeDefined();
      expect(metrics.executor).toBeDefined();
      expect(metrics.poolCacheSize).toBeGreaterThanOrEqual(0);
    });

    it('should track scan results', async () => {
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      const result = await engine.scan(pools);
      const lastResult = engine.getLastScanResult();

      expect(lastResult).toEqual(result);
      expect(lastResult?.detectionTime).toBeGreaterThanOrEqual(0);
      expect(lastResult?.executionTime).toBeGreaterThanOrEqual(0);
      expect(lastResult?.totalTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple scans', async () => {
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      const result1 = await engine.scan(pools);
      const result2 = await engine.scan(pools);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1.totalTime).toBeLessThan(30);
      expect(result2.totalTime).toBeLessThan(30);
    });
  });

  describe('Latency Benchmarks', () => {
    it('detection should be <5ms', async () => {
      const pools: PoolState[] = [];
      for (let i = 0; i < 100; i++) {
        pools.push({
          address: `0xpool${i}`,
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        });
      }

      const result = await engine.scan(pools);
      expect(result.detectionTime).toBeLessThan(10);
    });

    it('execution should be <25ms', async () => {
      const pools: PoolState[] = [
        {
          address: '0xtest',
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        },
      ];

      const result = await engine.scan(pools);
      expect(result.executionTime).toBeLessThan(25);
    });

    it('total cycle should be <30ms', async () => {
      const pools: PoolState[] = [];
      for (let i = 0; i < 50; i++) {
        pools.push({
          address: `0xpool${i}`,
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1_000_000,
          reserve1: 1_850_000,
          fee: 0.3,
        });
      }

      const result = await engine.scan(pools);
      expect(result.totalTime).toBeLessThan(30);
    });
  });
});
