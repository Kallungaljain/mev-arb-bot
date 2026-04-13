/**
 * MEV Bot tRPC Router + WebSocket Push Server
 *
 * Exposes:
 *   GET  /api/trpc/bot.status       — scanner state snapshot
 *   GET  /api/trpc/bot.opportunities — current ranked opportunities
 *   GET  /api/trpc/bot.history       — executed trade history
 *   POST /api/trpc/bot.start         — start the scanner
 *   POST /api/trpc/bot.stop          — stop the scanner
 *   POST /api/trpc/bot.updateSettings — update risk params
 *   WS   /api/ws                     — real-time push (state + opportunities)
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { EliteScanner, ScannerSettings } from "./scanner";
import type { ArbOpportunity, TradeRecord } from "../lib/bot-store";

// ─── Singleton Scanner Instance ────────────────────────────────────────────────

const DEFAULT_SETTINGS: ScannerSettings = {
  alchemyApiKey: process.env.ALCHEMY_API_KEY ?? "",
  minProfitUsd: 2,
  maxSlippagePct: 0.5,
  maxVolatilityPct: 5,
  maxGasGwei: 200,
  tradeAmountMatic: 1000,
};

export const scanner = new EliteScanner(DEFAULT_SETTINGS);

// In-memory trade history (persisted to DB in production)
const tradeHistory: TradeRecord[] = [];

scanner.on("trade", (record: TradeRecord) => {
  tradeHistory.unshift(record);
  if (tradeHistory.length > 500) tradeHistory.pop();
});

// ─── Bot Router ────────────────────────────────────────────────────────────────

export const botRouter = router({
  /** Current scanner state: running, gas, MATIC price, scan count, etc. */
  status: publicProcedure.query(() => {
    return scanner.getState();
  }),

  /** Current ranked arbitrage opportunities */
  opportunities: publicProcedure.query(() => {
    return scanner.getState().opportunities;
  }),

  /** Executed trade history */
  history: publicProcedure.query(() => {
    return tradeHistory;
  }),

  /** Start the scanner */
  start: publicProcedure
    .input(z.object({ alchemyApiKey: z.string().min(1) }).optional())
    .mutation(async ({ input }) => {
      if (input?.alchemyApiKey) {
        scanner.updateSettings({ alchemyApiKey: input.alchemyApiKey });
      }
      await scanner.start();
      return { ok: true };
    }),

  /** Stop the scanner */
  stop: publicProcedure.mutation(() => {
    scanner.stop();
    return { ok: true };
  }),

  /** Update risk / trade settings */
  updateSettings: publicProcedure
    .input(
      z.object({
        alchemyApiKey: z.string().optional(),
        minProfitUsd: z.number().min(0).optional(),
        maxSlippagePct: z.number().min(0).max(100).optional(),
        maxVolatilityPct: z.number().min(0).max(100).optional(),
        maxGasGwei: z.number().min(0).optional(),
        tradeAmountMatic: z.number().min(0).optional(),
      })
    )
    .mutation(({ input }) => {
      scanner.updateSettings(input as Partial<ScannerSettings>);
      return { ok: true };
    }),
});

export type BotRouter = typeof botRouter;
