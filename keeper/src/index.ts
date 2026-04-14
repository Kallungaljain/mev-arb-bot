// ─── Elite Keeper — Main Entry Point ─────────────────────────────────────────
//
// The Keeper is the bridge between the Rust scanner and the blockchain.
// It receives opportunities from the scanner, runs a final risk check,
// builds the flash loan calldata, signs and submits the transaction,
// and broadcasts results to connected Android app clients via WebSocket.

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { KeeperConfig } from "./config";
import { RiskEngine } from "./risk-engine";
import { BundleBuilder } from "./bundle-builder";
import { FlashLoanActivator } from "./activator";
import { StateManager } from "./state";
import { WsServer } from "./ws-server";
import { createRouter } from "./router";

async function main() {
  console.log("⚡ Elite Keeper v1.0.0 starting");

  const cfg = KeeperConfig.fromEnv();
  console.log(`Contract:     ${cfg.contractAddress}`);
  console.log(`Profit Wallet:${cfg.profitWallet}`);
  console.log(`Auto-Execute: ${cfg.autoExecute}`);
  console.log(`Min Profit:   $${(cfg.minProfitWei / 1e6).toFixed(2)} USDC`);

  // ── Core services ──────────────────────────────────────────────────────────
  const state     = new StateManager();
  const risk      = new RiskEngine(cfg);
  const builder   = new BundleBuilder(cfg);
  const activator = new FlashLoanActivator(cfg, state);

  // ── Express + HTTP server ──────────────────────────────────────────────────
  const app    = express();
  const server = createServer(app);
  app.use(express.json());

  // ── WebSocket push server ──────────────────────────────────────────────────
  const wsServer = new WsServer(server, cfg.wsSecret);

  // ── Routes ─────────────────────────────────────────────────────────────────
  const router = createRouter(cfg, state, risk, builder, activator, wsServer);
  app.use("/", router);

  // ── Start ──────────────────────────────────────────────────────────────────
  const port = cfg.port;
  server.listen(port, "0.0.0.0", () => {
    console.log(`✅ Keeper listening on port ${port}`);
    console.log(`   REST API: http://0.0.0.0:${port}/api`);
    console.log(`   WebSocket: ws://0.0.0.0:${port}/ws`);
    console.log(`   Internal:  http://0.0.0.0:${port}/internal`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down...");
    server.close(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    console.log("SIGINT received, shutting down...");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
