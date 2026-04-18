import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerWebSocketServer } from "../ws-server";
import { scanner } from "../bot-router";

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

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // REST API Endpoints for Bot Control
  app.get("/api/bot/status", (_req, res) => {
    try {
      const state = scanner.getState();
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bot/opportunities", (_req, res) => {
    try {
      const state = scanner.getState();
      res.json(state.opportunities || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bot/history", (_req, res) => {
    try {
      res.json([]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bot/start", express.json(), async (req, res) => {
    try {
      const { alchemyApiKey } = req.body;
      if (!alchemyApiKey) {
        return res.status(400).json({ error: "alchemyApiKey required" });
      }
      scanner.updateSettings({ alchemyApiKey });
      await scanner.start();
      res.json({ ok: true, message: "Scanner started" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bot/stop", (_req, res) => {
    try {
      scanner.stop();
      res.json({ ok: true, message: "Scanner stopped" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bot/settings", express.json(), (req, res) => {
    try {
      const { minProfitUsd, maxSlippagePct, maxVolatilityPct, maxGasGwei, tradeAmountMatic } = req.body;
      scanner.updateSettings({
        ...(minProfitUsd !== undefined && { minProfitUsd }),
        ...(maxSlippagePct !== undefined && { maxSlippagePct }),
        ...(maxVolatilityPct !== undefined && { maxVolatilityPct }),
        ...(maxGasGwei !== undefined && { maxGasGwei }),
        ...(tradeAmountMatic !== undefined && { tradeAmountMatic }),
      });
      res.json({ ok: true, message: "Settings updated" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Register WebSocket push server for real-time Android app updates
  registerWebSocketServer(server);

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
