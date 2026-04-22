/**
 * API Routes for MEV Bot
 * Wires production executor to mobile app
 */

import { Router, Request, Response } from 'express';
import { ProductionExecutor } from './production-executor';

let executor: ProductionExecutor | null = null;

/**
 * Initialize executor
 */
export async function initializeExecutor(alchemyKey: string): Promise<void> {
  executor = new ProductionExecutor({
    alchemyKey,
    maxSlippagePercent: 0.5,
    maxPriceImpact: 2,
    minProfitMargin: 0.1,
  });

  await executor.initialize();
}

/**
 * Create API router
 */
export function createBotRouter(): Router {
  const router = Router();

  /**
   * POST /api/bot/wallet/set-keys
   * Set trading wallet private key and profit address
   */
  router.post('/api/bot/wallet/set-keys', (req: Request, res: Response) => {
    try {
      if (!executor) {
        return res.status(503).json({ error: 'Executor not initialized' });
      }

      const { tradingKey, profitAddress } = req.body;

      if (!tradingKey || !profitAddress) {
        return res.status(400).json({ error: 'Missing tradingKey or profitAddress' });
      }

      executor.setWalletKeys(tradingKey, profitAddress);

      res.json({
        success: true,
        message: 'Wallet keys set successfully',
      });
    } catch (error: any) {
      console.error('[API] Set wallet keys failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/bot/start
   * Start trading bot
   */
  router.post('/api/bot/start', async (req: Request, res: Response) => {
    try {
      if (!executor) {
        return res.status(503).json({ error: 'Executor not initialized' });
      }

      const { poolAddresses, scanInterval } = req.body;

      if (!poolAddresses || !Array.isArray(poolAddresses)) {
        return res.status(400).json({ error: 'Invalid poolAddresses' });
      }

      // Start bot in background
      executor.start(poolAddresses, scanInterval || 1000).catch((error) => {
        console.error('[API] Bot error:', error.message);
      });

      res.json({
        success: true,
        message: 'Bot started',
      });
    } catch (error: any) {
      console.error('[API] Start bot failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/bot/stop
   * Stop trading bot
   */
  router.post('/api/bot/stop', (req: Request, res: Response) => {
    try {
      if (!executor) {
        return res.status(503).json({ error: 'Executor not initialized' });
      }

      executor.stop();

      res.json({
        success: true,
        message: 'Bot stopped',
      });
    } catch (error: any) {
      console.error('[API] Stop bot failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /api/bot/stats
   * Get bot statistics
   */
  router.get('/api/bot/stats', (req: Request, res: Response) => {
    try {
      if (!executor) {
        return res.status(503).json({ error: 'Executor not initialized' });
      }

      const stats = executor.getStats();

      res.json({
        success: true,
        stats,
      });
    } catch (error: any) {
      console.error('[API] Get stats failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /api/bot/health
   * Get bot health status
   */
  router.get('/api/bot/health', async (req: Request, res: Response) => {
    try {
      if (!executor) {
        return res.status(503).json({ error: 'Executor not initialized' });
      }

      const health = await executor.getHealthStatus();

      res.json({
        success: true,
        health,
      });
    } catch (error: any) {
      console.error('[API] Get health failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/bot/shutdown
   * Shutdown bot
   */
  router.post('/api/bot/shutdown', async (req: Request, res: Response) => {
    try {
      if (!executor) {
        return res.status(503).json({ error: 'Executor not initialized' });
      }

      await executor.shutdown();
      executor = null;

      res.json({
        success: true,
        message: 'Bot shutdown complete',
      });
    } catch (error: any) {
      console.error('[API] Shutdown failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /api/bot/status
   * Get bot status
   */
  router.get('/api/bot/status', (req: Request, res: Response) => {
    try {
      const isRunning = executor !== null;

      res.json({
        success: true,
        running: isRunning,
        executor: isRunning ? 'initialized' : 'not-initialized',
      });
    } catch (error: any) {
      console.error('[API] Get status failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

/**
 * Get current executor
 */
export function getExecutor(): ProductionExecutor | null {
  return executor;
}
