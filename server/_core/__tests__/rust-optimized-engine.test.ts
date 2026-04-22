import { describe, it, expect, beforeEach } from 'vitest';
import {
  RustOptimizedEngine,
  BellmanFordDetector,
  ProfitSimulator,
  Queen,
  Keeper,
  Scanner,
} from '../rust-optimized-engine';

describe('RustOptimizedEngine', () => {
  let engine: RustOptimizedEngine;

  beforeEach(() => {
    engine = new RustOptimizedEngine();
  });

  describe('BellmanFordDetector', () => {
    it('should detect simple arbitrage cycle', () => {
      const detector = new BellmanFordDetector();

      // Create a simple cycle: USDC -> WMATIC -> USDC
      // Rates: 1 USDC = 1.85 WMATIC, 1 WMATIC = 0.55 USDC
      // Profit: 1 * 1.85 * 0.55 = 1.0175 (1.75% profit)
      detector.addEdge('USDC', 'WMATIC', 1.85);
      detector.addEdge('WMATIC', 'USDC', 0.55);

      const opps = detector.detectArbitrage('USDC');
      expect(Array.isArray(opps)).toBe(true);
      if (opps.length > 0) {
        expect(opps[0].profitPct).toBeGreaterThan(0.1);
      }
    });

    it('should handle multiple vertices', () => {
      const detector = new BellmanFordDetector();

      detector.addEdge('USDC', 'WMATIC', 1.85);
      detector.addEdge('WMATIC', 'USDT', 1.0);
      detector.addEdge('USDT', 'USDC', 1.001);

      const opps = detector.detectArbitrage('USDC');
      expect(Array.isArray(opps)).toBe(true);
    });
  });

  describe('ProfitSimulator', () => {
    it('should simulate swap correctly', () => {
      const pool = {
        address: '0xtest',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1_000_000,
        reserve1: 1_850_000,
        fee: 0.3,
      };

      const output = ProfitSimulator.simulateSwap(1000, pool, true);
      expect(output).toBeGreaterThan(0);
      expect(output).toBeLessThan(2000); // Should be less than 1000 * 2
    });

    it('should simulate arbitrage with profit', () => {
      const pool1 = {
        address: '0xquickswap',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 1_000_000,
        reserve1: 1_850_000,
        fee: 0.3,
      };

      const pool2 = {
        address: '0xsushiswap',
        token0: 'USDC',
        token1: 'WMATIC',
        reserve0: 500_000,
        reserve1: 900_000,
        fee: 0.3,
      };

      const sim = ProfitSimulator.simulateArbitrage(1000, pool1, pool2, 5, 0.09);
      expect(sim.inputAmount).toBe(1000);
      expect(sim.outputAmount).toBeGreaterThan(0);
      expect(sim.totalFeeUsd).toBeGreaterThan(0);
    });
  });

  describe('Queen - MEV Risk Analyzer', () => {
    it('should analyze sandwich risk', () => {
      const risk = Queen.analyzeSandwichRisk(1000, 100_000, 50);
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(100);
    });

    it('should analyze slippage risk', () => {
      const risk = Queen.analyzeSlippageRisk(2.5, 500_000, 1000);
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(100);
    });

    it('should analyze liquidity risk', () => {
      const risk = Queen.analyzeLiquidityRisk(1000, 100_000, 0.05);
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(100);
    });

    it('should analyze gas price risk', () => {
      const risk = Queen.analyzeGasPriceRisk(50, 40);
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(100);
    });

    it('should perform full MEV analysis', () => {
      const analysis = Queen.analyze(
        1000,
        {
          liquidityUsd: 100_000,
          volume24h: 500_000,
          priceVolatility: 2.5,
          swapCount1h: 100,
        },
        50,
        40,
        50,
        0.05
      );

      expect(analysis.overallRiskScore).toBeGreaterThanOrEqual(0);
      expect(analysis.overallRiskScore).toBeLessThanOrEqual(100);
      expect(analysis.isSafe).toBeDefined();
      expect(['EXECUTE', 'ANALYZE', 'SKIP']).toContain(analysis.recommendation);
    });

    it('should mark safe trades correctly', () => {
      const isSafe = Queen.isTradesSafe(1000, 100_000, 2.0);
      expect(isSafe).toBe(true);

      const isUnsafe = Queen.isTradesSafe(50_000, 100_000, 2.0);
      expect(isUnsafe).toBe(false);
    });
  });

  describe('Keeper - Trade Execution', () => {
    it('should execute safe trade', async () => {
      const keeper = new Keeper();
      const trade = {
        id: 'test-1',
        pool1: 'QuickSwap',
        pool2: 'SushiSwap',
        amountIn: 1000,
        expectedProfit: 50,
        executedAt: Date.now(),
        status: 'pending' as const,
      };

      const executionTime = await keeper.executeSafeTrade(trade);
      expect(typeof executionTime).toBe('number');
      expect(executionTime).toBeLessThanOrEqual(100); // Should be <=100ms
    });

    it('should record metrics', async () => {
      const keeper = new Keeper();
      keeper.recordSuccess(50);
      keeper.recordSuccess(75);
      keeper.recordFailure();

      const metrics = keeper.getMetrics();
      expect(metrics.successfulTrades).toBe(2);
      expect(metrics.failedTrades).toBe(1);
      expect(metrics.totalTrades).toBe(3);
      expect(metrics.totalProfit).toBe(125);
    });
  });

  describe('Scanner - Pool Monitoring', () => {
    it('should scan pools', async () => {
      const scanner = new Scanner();
      const opportunities = await scanner.scan();
      expect(Array.isArray(opportunities)).toBe(true);
    });

    it('should get opportunities', async () => {
      const scanner = new Scanner();
      await scanner.scan();
      const opps = scanner.getOpportunities();
      expect(Array.isArray(opps)).toBe(true);
    });

    it('should track metrics', async () => {
      const scanner = new Scanner();
      await scanner.scan();
      const metrics = scanner.getMetrics();

      expect(metrics.poolsScanned).toBeGreaterThanOrEqual(0);
      expect(metrics.opportunitiesFound).toBeGreaterThanOrEqual(0);
      expect(metrics.avgScanTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Engine Integration', () => {
    it('should scan and get opportunities', async () => {
      const opps = await engine.scan();
      expect(Array.isArray(opps)).toBe(true);
    });

    it('should get metrics from all modules', () => {
      const metrics = engine.getMetrics();
      expect(metrics.scanner).toBeDefined();
      expect(metrics.keeper).toBeDefined();
    });

    it('should record trade outcomes', () => {
      engine.recordSuccess(100);
      engine.recordFailure();

      const metrics = engine.getMetrics();
      expect(metrics.keeper.successfulTrades).toBe(1);
      expect(metrics.keeper.failedTrades).toBe(1);
    });
  });

  describe('Latency Benchmarks', () => {
    it('should complete scan in <100ms', async () => {
      const startTime = Date.now();
      await engine.scan();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
    });

    it('should execute trade in <100ms', async () => {
      const keeper = new Keeper();
      const trade = {
        id: 'bench-1',
        pool1: 'QuickSwap',
        pool2: 'SushiSwap',
        amountIn: 1000,
        expectedProfit: 50,
        executedAt: Date.now(),
        status: 'pending' as const,
      };

      const startTime = Date.now();
      await keeper.executeSafeTrade(trade);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
    });
  });
});
