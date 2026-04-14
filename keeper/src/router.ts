// ─── Keeper REST API Router ───────────────────────────────────────────────────
//
// Exposes two sets of routes:
//   /api/*       — Android app public API (authenticated via X-WS-Secret header)
//   /internal/*  — Rust scanner IPC (authenticated via X-Keeper-Secret header)

import { Router, Request, Response, NextFunction } from "express";
import { KeeperConfig } from "./config";
import { StateManager } from "./state";
import { RiskEngine } from "./risk-engine";
import { BundleBuilder } from "./bundle-builder";
import { FlashLoanActivator } from "./activator";
import { WsServer } from "./ws-server";
import { Opportunity } from "./types";

export function createRouter(
  cfg: KeeperConfig,
  state: StateManager,
  risk: RiskEngine,
  builder: BundleBuilder,
  activator: FlashLoanActivator,
  wsServer: WsServer,
): Router {
  const router = Router();

  // ── Auth middleware ────────────────────────────────────────────────────────

  const requireApiAuth = (req: Request, res: Response, next: NextFunction) => {
    const secret = req.headers["x-ws-secret"] ?? req.query.secret;
    if (secret !== cfg.wsSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  const requireInternalAuth = (req: Request, res: Response, next: NextFunction) => {
    const secret = req.headers["x-keeper-secret"];
    if (secret !== cfg.internalSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  // ── Public API routes (/api) ───────────────────────────────────────────────

  router.get("/api/status", requireApiAuth, (_req, res) => {
    res.json(state.getStatus(cfg.contractAddress, cfg.profitWallet));
  });

  router.get("/api/opportunities", requireApiAuth, (_req, res) => {
    res.json(state.opportunities);
  });

  router.get("/api/history", requireApiAuth, (_req, res) => {
    const limit = parseInt(String(_req.query.limit ?? "50"));
    res.json(state.trades.slice(0, limit));
  });

  router.post("/api/bot/start", requireApiAuth, (_req, res) => {
    state.setRunning(true);
    wsServer.broadcastStatus(state.getStatus(cfg.contractAddress, cfg.profitWallet));
    res.json({ success: true, running: true });
  });

  router.post("/api/bot/stop", requireApiAuth, (_req, res) => {
    state.setRunning(false);
    wsServer.broadcastStatus(state.getStatus(cfg.contractAddress, cfg.profitWallet));
    res.json({ success: true, running: false });
  });

  router.post("/api/bot/auto-execute", requireApiAuth, (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    state.setAutoExecute(!!enabled);
    wsServer.broadcastStatus(state.getStatus(cfg.contractAddress, cfg.profitWallet));
    res.json({ success: true, autoExecute: state.autoExecute });
  });

  // Manual execute — Android app triggers a specific opportunity
  router.post("/api/execute", requireApiAuth, async (req, res) => {
    const opp = req.body as Opportunity;

    const riskResult = await risk.assess(opp);
    if (!riskResult.approved) {
      res.json({ success: false, reason: riskResult.reason });
      return;
    }

    const bundle = builder.build(opp, riskResult.adjustedNetProfitUsd ?? 0);
    const trade = await activator.execute(opp, bundle);

    wsServer.broadcastTradeUpdate(trade);
    res.json({ success: true, trade });
  });

  router.get("/api/wallet", requireApiAuth, async (_req, res) => {
    try {
      const wallet = await activator.getWalletBalance();
      res.json(wallet);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Internal routes (/internal) — Rust scanner IPC ────────────────────────

  router.post("/internal/opportunity", requireInternalAuth, async (req, res) => {
    const opp = req.body as Opportunity;

    state.incrementScanCount();
    state.addOpportunity(opp);

    // Broadcast to Android app immediately
    wsServer.broadcastOpportunity(opp);

    // Auto-execute if enabled and bot is running
    if (state.running && state.autoExecute) {
      // Run async — don't block the scanner
      (async () => {
        try {
          const riskResult = await risk.assess(opp);
          if (!riskResult.approved) {
            console.log(`Risk rejected: ${riskResult.reason}`);
            state.recordTrade(opp, "skipped", { skipReason: riskResult.reason });
            return;
          }

          const bundle = builder.build(opp, riskResult.adjustedNetProfitUsd ?? 0);
          const trade = await activator.execute(opp, bundle);
          wsServer.broadcastTradeUpdate(trade);
          wsServer.broadcastStatus(state.getStatus(cfg.contractAddress, cfg.profitWallet));
        } catch (err: any) {
          console.error("Auto-execute error:", err.message);
        }
      })();
    }

    res.json({ received: true });
  });

  // ── Health check ───────────────────────────────────────────────────────────

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  return router;
}
