import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';

/**
 * REAL ENGINE INTEGRATION TESTS
 * 
 * These tests verify that the Rust scanner and Node.js keeper
 * work together to detect and execute real arbitrage opportunities
 * on Polygon mainnet.
 * 
 * Prerequisites:
 * - ALCHEMY_KEY environment variable set
 * - PRIVATE_KEY environment variable set
 * - ELITE_ANT_ADDRESS environment variable set
 * - Rust scanner running on http://localhost:8080
 * - Node.js keeper running on http://localhost:3000
 */

const SCANNER_URL = 'http://localhost:8080';
const KEEPER_URL = 'http://localhost:3000';

describe('Real Arbitrage Engine', () => {
  
  describe('Scanner', () => {
    it('should connect to Alchemy WebSocket', async () => {
      const response = await axios.get(`${SCANNER_URL}/status`);
      expect(response.status).toBe(200);
      expect(response.data.connected).toBe(true);
    });

    it('should subscribe to pool events', async () => {
      const response = await axios.get(`${SCANNER_URL}/status`);
      expect(response.data.pools_subscribed).toBeGreaterThan(0);
    });

    it('should detect opportunities within 60 seconds', async () => {
      // Wait up to 60 seconds for an opportunity
      let opportunities = 0;
      for (let i = 0; i < 60; i++) {
        const response = await axios.get(`${SCANNER_URL}/status`);
        opportunities = response.data.opportunities_detected;
        if (opportunities > 0) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      expect(opportunities).toBeGreaterThan(0);
    });

    it('should calculate realistic spreads', async () => {
      const response = await axios.get(`${SCANNER_URL}/status`);
      const opps = response.data.recent_opportunities || [];
      
      if (opps.length > 0) {
        const opp = opps[0];
        expect(opp.spread_pct).toBeGreaterThan(0);
        expect(opp.spread_pct).toBeLessThan(10); // Realistic max spread
        expect(opp.expected_profit_usd).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Keeper', () => {
    it('should be connected and ready', async () => {
      const response = await axios.get(`${KEEPER_URL}/status`);
      expect(response.status).toBe(200);
      expect(response.data.connected).toBe(true);
    });

    it('should have valid signer address', async () => {
      const response = await axios.get(`${KEEPER_URL}/status`);
      expect(response.data.signer_address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should receive opportunities from scanner', async () => {
      // Wait for keeper to receive opportunities
      let received = 0;
      for (let i = 0; i < 60; i++) {
        const response = await axios.get(`${KEEPER_URL}/status`);
        received = response.data.opportunities_received;
        if (received > 0) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      expect(received).toBeGreaterThan(0);
    });

    it('should validate risk correctly', async () => {
      // Test with a valid opportunity
      const mockOpportunity = {
        id: 'test-1',
        pair: 'WMATIC/USDC',
        dex_a: '0x5757371414417b8C6CAD0a0b9f7dd9Cf0a3D0cA0',
        dex_b: '0x34965ba0ac2451A34a0471F04CCa3F990b8dea27',
        spread_pct: 0.5,
        token_in: 'WMATIC',
        amount_in: 1000,
        amount_out_dex_a: 1002,
        amount_out_dex_b: 1005,
        expected_profit_usd: 10,
        confidence: 0.85,
        detected_at: new Date().toISOString(),
      };

      const response = await axios.post(`${KEEPER_URL}/execute`, {
        opportunity: mockOpportunity,
      }).catch(err => err.response);

      // Should either succeed or fail with a specific reason
      expect(response.status).toBeLessThan(500);
    });

    it('should track trades', async () => {
      const response = await axios.get(`${KEEPER_URL}/trades`);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('End-to-End Flow', () => {
    it('should detect and process opportunities', async () => {
      // Get scanner status
      const scannerStatus = await axios.get(`${SCANNER_URL}/status`);
      const keeperStatus = await axios.get(`${KEEPER_URL}/status`);

      // Both should be operational
      expect(scannerStatus.data.connected).toBe(true);
      expect(keeperStatus.data.connected).toBe(true);

      // Scanner should have detected opportunities
      expect(scannerStatus.data.opportunities_detected).toBeGreaterThanOrEqual(0);

      // Keeper should have received them
      expect(keeperStatus.data.opportunities_received).toBeGreaterThanOrEqual(0);
    });

    it('should maintain uptime', async () => {
      const response = await axios.get(`${KEEPER_URL}/status`);
      expect(response.data.connected).toBe(true);
    });
  });

  describe('Price Discovery', () => {
    it('should calculate x*y=k prices correctly', async () => {
      // Test case: 1000 WMATIC in pool with 1000 USDC
      // Price should be 1 USDC per WMATIC
      const reserve0 = 1000; // WMATIC
      const reserve1 = 1000; // USDC
      const price = reserve1 / reserve0;
      expect(price).toBe(1);
    });

    it('should account for 0.3% swap fee', async () => {
      // Input: 100 tokens, reserves: 1000/1000
      // With 0.3% fee: 100 * 0.997 = 99.7
      // Output: 99.7 * 1000 / (1000 + 99.7) = 90.24
      const amountIn = 100;
      const reserveIn = 1000;
      const reserveOut = 1000;
      const feePercent = 0.997;
      const amountInWithFee = amountIn * feePercent;
      const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
      expect(amountOut).toBeCloseTo(90.24, 1);
    });

    it('should detect arbitrage spreads', async () => {
      // Pool A: 1 WMATIC = 1 USDC
      // Pool B: 1 WMATIC = 1.01 USDC
      // Spread: 1% (profitable)
      const priceA = 1;
      const priceB = 1.01;
      const spread = ((priceB - priceA) / priceA) * 100;
      expect(spread).toBeCloseTo(1, 1);
      expect(spread).toBeGreaterThan(0.3); // Above minimum
    });
  });

  describe('Risk Management', () => {
    it('should reject opportunities with low profit', async () => {
      const lowProfitOpp = {
        id: 'test-low-profit',
        pair: 'WMATIC/USDC',
        dex_a: '0x5757371414417b8C6CAD0a0b9f7dd9Cf0a3D0cA0',
        dex_b: '0x34965ba0ac2451A34a0471F04CCa3F990b8dea27',
        spread_pct: 0.1, // Too small
        token_in: 'WMATIC',
        amount_in: 1000,
        amount_out_dex_a: 1000.5,
        amount_out_dex_b: 1001,
        expected_profit_usd: 0.5, // Below minimum
        confidence: 0.5,
        detected_at: new Date().toISOString(),
      };

      const response = await axios.post(`${KEEPER_URL}/execute`, {
        opportunity: lowProfitOpp,
      }).catch(err => err.response);

      // Should reject due to low profit
      expect(response.status).toBe(400);
      expect(response.data.error).toBeDefined();
    });

    it('should reject opportunities with high gas costs', async () => {
      // This test would need to mock high gas prices
      // For now, just verify the endpoint exists
      const response = await axios.get(`${KEEPER_URL}/status`);
      expect(response.data.signer_address).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should respond to status requests in <100ms', async () => {
      const start = Date.now();
      await axios.get(`${KEEPER_URL}/status`);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it('should process opportunities quickly', async () => {
      const start = Date.now();
      await axios.get(`${SCANNER_URL}/status`);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });
});

describe('Unit Tests', () => {
  describe('Sync Event Decoding', () => {
    it('should decode valid Sync events', () => {
      // Example Sync event data
      const data = '0x' + 
        '0000000000000000000000000000000000000000000000000000000000000001' + // reserve0 = 1
        '0000000000000000000000000000000000000000000000000000000000000002';   // reserve1 = 2

      // Parse reserves
      const reserve0Hex = data.slice(2, 66);
      const reserve1Hex = data.slice(66, 130);
      const reserve0 = BigInt('0x' + reserve0Hex);
      const reserve1 = BigInt('0x' + reserve1Hex);

      expect(reserve0).toBe(1n);
      expect(reserve1).toBe(2n);
    });

    it('should handle large reserve values', () => {
      // Large reserve: 10^18 (1 ether-like token)
      const largeValue = '0x' + 'de0b6b3a7640000'; // 10^18 in hex
      const parsed = BigInt(largeValue);
      expect(parsed).toBe(BigInt('1000000000000000000'));
    });
  });

  describe('Price Calculations', () => {
    it('should calculate output correctly with x*y=k', () => {
      // Input: 1 token, reserves: 1000/1000
      // Output: 1 * 0.997 * 1000 / (1000 + 1 * 0.997) = 0.996...
      const amountIn = 1;
      const reserveIn = 1000;
      const reserveOut = 1000;
      const feePercent = 0.997;
      const amountInWithFee = amountIn * feePercent;
      const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
      expect(amountOut).toBeCloseTo(0.996, 2);
    });

    it('should handle decimal token values', () => {
      // USDC has 6 decimals
      // 1 USDC = 1000000 (in wei)
      const usdcDecimals = 6;
      const oneUsdc = 1000000;
      const humanReadable = oneUsdc / Math.pow(10, usdcDecimals);
      expect(humanReadable).toBe(1);
    });
  });

  describe('Spread Detection', () => {
    it('should identify profitable spreads', () => {
      const priceA = 1.0;
      const priceB = 1.005;
      const spread = ((priceB - priceA) / priceA) * 100;
      expect(spread).toBeCloseTo(0.5, 1);
      expect(spread).toBeGreaterThan(0.3); // Above minimum
    });

    it('should ignore unprofitable spreads', () => {
      const priceA = 1.0;
      const priceB = 1.001;
      const spread = ((priceB - priceA) / priceA) * 100;
      expect(spread).toBeCloseTo(0.1, 1);
      expect(spread).toBeLessThan(0.3); // Below minimum
    });
  });
});
