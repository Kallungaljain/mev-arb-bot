import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerWebSocketServer } from "../ws-server";
import { mevEngine } from "./mev-engine";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);

  // ─── Health Check ────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: Date.now(),
      botRunning: mevEngine.getState().isRunning,
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: Date.now(),
      botRunning: mevEngine.getState().isRunning,
    });
  });

  // ─── Validate Alchemy Key ────────────────────────────────────────────────────
  app.post("/api/validate-alchemy", express.json(), async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ valid: false, error: "API key required" });
      }
      const isValid = await mevEngine.validateAlchemyKey(apiKey);
      res.json({ valid: isValid });
    } catch (err: any) {
      res.status(500).json({ valid: false, error: err.message });
    }
  });

  // ─── Get Bot Status ───────────────────────────────────────────────────────────
  app.get("/api/status", (_req, res) => {
    try {
      const state = mevEngine.getState();
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Get Opportunities ────────────────────────────────────────────────────────
  app.get("/api/opportunities", (_req, res) => {
    try {
      const opportunities = mevEngine.getOpportunities();
      res.json({ opportunities, count: opportunities.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Scan for Opportunities ──────────────────────────────────────────────────
  app.post("/api/scan", express.json(), async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: "API key required" });
      }

      // Validate key first
      const isValid = await mevEngine.validateAlchemyKey(apiKey);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid Alchemy API key" });
      }

      // Start engine if not already running
      const state = mevEngine.getState();
      if (!state.isRunning) {
        await mevEngine.start(apiKey);
      }

      // Get current opportunities
      const opportunities = mevEngine.getOpportunities();
      const gasPrice = state.gasPrice || 30;
      const maticPrice = state.maticPrice || 0.55;

      res.json({ opportunities, gasGwei: gasPrice, maticPriceUsd: maticPrice });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Start Bot ────────────────────────────────────────────────────────────────
  app.post("/api/bot/start", express.json(), async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: "API key required" });
      }

      await mevEngine.start(apiKey);
      res.json({ status: "started", message: "Bot started successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Stop Bot ─────────────────────────────────────────────────────────────────
  app.post("/api/bot/stop", (_req, res) => {
    try {
      mevEngine.stop();
      res.json({ status: "stopped", message: "Bot stopped successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  registerWebSocketServer(server);

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
    console.log(`[api] MEV Engine ready - Health check: http://localhost:${port}/health`);
  });
}

startServer().catch(console.error);
