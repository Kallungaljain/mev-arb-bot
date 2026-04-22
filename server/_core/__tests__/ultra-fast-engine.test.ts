import { describe, it, expect, beforeEach } from 'vitest';
import { UltraFastEngine, UltraFastDetector, UltraFastQueen, UltraFastKeeper } from '../ultra-fast-engine';

describe('UltraFastEngine', () => {
  let engine: UltraFastEngine;

  beforeEach(() => {
    engine = new UltraFastEngine();
  });

  describe('Detector', () => {
    it('should create detector', () => {
      const detector = new UltraFastDetector(100);
      expect(detector).toBeDefined();
    });

    it('should add pools', () => {
      const detector = new UltraFastDetector(100);
      detector.addPool({
        address: '0x1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1000000,
        reserve1: 1850000,
      });

      expect(detector).toBeDefined();
    });

    it('should detect opportunities', () => {
      const detector = new UltraFastDetector(100);

      detector.addPool({
        address: '0x1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1000000,
        reserve1: 1850000,
      });

      detector.addPool({
        address: '0x2',
        token0: 'WMATIC',
        token1: 'USDC',
        reserve0: 1900000,
        reserve1: 1000000,
      });

      const opportunities = detector.detect('USDC', 3);
      expect(Array.isArray(opportunities)).toBe(true);
    });
  });

  describe('Queen Risk Analyzer', () => {
    it('should analyze low-profit trades as safe', () => {
      const riskScore = UltraFastQueen.analyze(0.5, 1000000, 3);
      expect(riskScore).toBeLessThan(40);
    });

    it('should analyze high-profit trades as risky', () => {
      const riskScore = UltraFastQueen.analyze(5.0, 1000000, 3);
      expect(riskScore).toBeGreaterThan(40);
    });

    it('should analyze low-liquidity trades as risky', () => {
      const riskScore = UltraFastQueen.analyze(1.0, 10000, 3);
      expect(riskScore).toBeGreaterThan(UltraFastQueen.analyze(1.0, 1000000, 3));
    });

    it('should cap risk score at 100', () => {
      const riskScore = UltraFastQueen.analyze(50.0, 1000, 10);
      expect(riskScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Keeper Executor', () => {
    it('should execute simple swap', () => {
      const result = UltraFastKeeper.execute(['USDC', 'WMATIC', 'USDC'], [100, 185, 100], 2.0);

      expect(result.success).toBe(true);
      expect(result.gasUsed).toBeGreaterThan(0);
      expect(result.profit).toBeGreaterThan(0);
    });

    it('should calculate gas correctly', () => {
      const result2 = UltraFastKeeper.execute(['USDC', 'WMATIC', 'USDC'], [100, 185, 100], 2.0);
      const result3 = UltraFastKeeper.execute(
        ['USDC', 'WMATIC', 'DAI', 'USDC'],
        [100, 185, 100, 100],
        2.0
      );

      expect(result3.gasUsed).toBeGreaterThan(result2.gasUsed);
    });

    it('should account for gas costs in profit', () => {
      const result = UltraFastKeeper.execute(['USDC', 'WMATIC', 'USDC'], [100, 185, 100], 100.0);
      expect(result.profit).toBeLessThan(100.0);
      expect(result.profit).toBeCloseTo(95.0, 0);
    });
  });

  describe('Main Engine', () => {
    it('should add pools', () => {
      engine.addPool({
        address: '0x1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1000000,
        reserve1: 1850000,
      });

      expect(engine).toBeDefined();
    });

    it('should scan for opportunities', () => {
      engine.addPool({
        address: '0x1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1000000,
        reserve1: 1850000,
      });

      const result = engine.scan('USDC');

      expect(result.opportunities).toBeDefined();
      expect(result.latencyMs).toBeLessThan(10);
      expect(result.scanCount).toBe(1);
    });

    it('should execute opportunity', () => {
      const opportunity = {
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 1.5,
        profitUsd: 2.0,
        riskScore: 20,
        calldata: '0x' + '0'.repeat(128),
      };

      const result = engine.execute(opportunity);

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeLessThan(5);
      expect(result.profit).toBeGreaterThan(0);
    });

    it('should track metrics', () => {
      engine.scan('USDC');
      engine.scan('USDC');

      const metrics = engine.getMetrics();

      expect(metrics.scans).toBe(2);
      expect(metrics.avgLatency).toBeLessThan(10);
    });

    it('should achieve <10ms latency', () => {
      // Add pools
      for (let i = 0; i < 50; i++) {
        engine.addPool({
          address: `0x${i}`,
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1000000 + i * 10000,
          reserve1: 1850000 + i * 18500,
        });
      }

      // Scan
      const result = engine.scan('USDC');

      expect(result.latencyMs).toBeLessThan(10);
    });

    it('should clear state', () => {
      engine.addPool({
        address: '0x1',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1000000,
        reserve1: 1850000,
      });

      engine.clear();
      const metrics = engine.getMetrics();

      expect(metrics.lastOpportunities).toBe(0);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should scan 100 pools in <10ms', () => {
      // Add 100 pools
      for (let i = 0; i < 100; i++) {
        engine.addPool({
          address: `0x${i}`,
          token0: 'USDC',
          token1: 'WMATIC',
          reserve0: 1000000,
          reserve1: 1850000,
        });
      }

      const startTime = performance.now();
      engine.scan('USDC');
      const latency = performance.now() - startTime;

      expect(latency).toBeLessThan(10);
    });

    it('should execute trade in <5ms', () => {
      const opportunity = {
        path: ['USDC', 'WMATIC', 'USDC'],
        profitPct: 1.5,
        profitUsd: 2.0,
        riskScore: 20,
        calldata: '0x' + '0'.repeat(128),
      };

      const startTime = performance.now();
      engine.execute(opportunity);
      const latency = performance.now() - startTime;

      expect(latency).toBeLessThan(5);
    });

    it('should analyze risk in <3ms', () => {
      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        UltraFastQueen.analyze(1.5, 1000000, 3);
      }

      const latency = performance.now() - startTime;
      expect(latency).toBeLessThan(3);
    });
  });
});
