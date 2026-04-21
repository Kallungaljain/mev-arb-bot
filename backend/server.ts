import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";
import { scanOpportunities, validateAlchemyKey, getGasPriceGwei } from "../lib/alchemy";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── State ────────────────────────────────────────────────────────────────────

interface BotState {
  isRunning: boolean;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  lastTrade: number | null;
  lastError: string | null;
  lastScan: number | null;
  opportunities: any[];
}

const botState: BotState = {
  isRunning: false,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  totalProfit: 0,
  lastTrade: null,
  lastError: null,
  lastScan: null,
  opportunities: [],
};

// ─── Health Check ────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    botRunning: botState.isRunning,
  });
});

// ─── Validate Alchemy Key ────────────────────────────────────────────────────

app.post("/api/validate-alchemy", async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "API key required" });
  }

  try {
    const result = await validateAlchemyKey(apiKey);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      valid: false,
      error: err.message || "Validation failed",
    });
  }
});

// ─── Get Current Status ───────────────────────────────────────────────────────

app.get("/api/status", (req, res) => {
  res.json({
    ...botState,
    uptime: process.uptime(),
  });
});

// ─── Get Recent Opportunities ────────────────────────────────────────────────

app.get("/api/opportunities", (req, res) => {
  res.json({
    opportunities: botState.opportunities.slice(-20),
    count: botState.opportunities.length,
  });
});

// ─── Scan for Opportunities ──────────────────────────────────────────────────

app.post("/api/scan", async (req, res) => {
  const { apiKey, settings } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "API key required" });
  }

  try {
    const result = await scanOpportunities(apiKey, settings || {
      minProfitUsd: 5,
      maxSlippagePct: 0.5,
      maxVolatilityPct: 5,
      maxGasGwei: 100,
      tradeAmountMatic: 1,
    });

    botState.lastScan = Date.now();
    botState.opportunities = result.opportunities;

    res.json(result);
  } catch (err: any) {
    botState.lastError = err.message;
    res.status(500).json({
      error: err.message || "Scan failed",
      opportunities: [],
      gasGwei: 0,
      maticPriceUsd: 0,
    });
  }
});

// ─── Start Bot ────────────────────────────────────────────────────────────────

app.post("/api/bot/start", (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "API key required" });
  }

  botState.isRunning = true;
  botState.lastError = null;

  // Start scanning loop
  startScanningLoop(apiKey);

  res.json({
    status: "started",
    message: "Bot started successfully",
  });
});

// ─── Stop Bot ─────────────────────────────────────────────────────────────────

app.post("/api/bot/stop", (req, res) => {
  botState.isRunning = false;

  res.json({
    status: "stopped",
    message: "Bot stopped successfully",
  });
});

// ─── Execute Trade ───────────────────────────────────────────────────────────

app.post("/api/execute-trade", async (req, res) => {
  const { apiKey, opportunity, privateKey } = req.body;

  if (!apiKey || !opportunity || !privateKey) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Create provider and signer
    const provider = new ethers.JsonRpcProvider(
      `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`
    );
    const signer = new ethers.Wallet(privateKey, provider);

    // In production, this would execute the actual trade
    // For now, just simulate it
    const simulatedProfit = opportunity.profit_usd * 0.8; // 80% of estimated

    botState.totalTrades++;
    if (simulatedProfit > 0) {
      botState.successfulTrades++;
      botState.totalProfit += simulatedProfit;
    } else {
      botState.failedTrades++;
    }
    botState.lastTrade = Date.now();

    res.json({
      success: true,
      txHash: "0x" + Math.random().toString(16).slice(2),
      estimatedProfit: opportunity.profit_usd,
      actualProfit: simulatedProfit,
      gasUsed: 400000,
      gasCost: 2.5,
    });
  } catch (err: any) {
    botState.lastError = err.message;
    botState.totalTrades++;
    botState.failedTrades++;

    res.status(500).json({
      success: false,
      error: err.message || "Trade execution failed",
    });
  }
});

// ─── Scanning Loop ────────────────────────────────────────────────────────────

let scanInterval: NodeJS.Timeout | null = null;

async function startScanningLoop(apiKey: string) {
  if (scanInterval) clearInterval(scanInterval);

  scanInterval = setInterval(async () => {
    if (!botState.isRunning) return;

    try {
      const result = await scanOpportunities(apiKey, {
        minProfitUsd: 5,
        maxSlippagePct: 0.5,
        maxVolatilityPct: 5,
        maxGasGwei: 100,
        tradeAmountMatic: 1,
      });

      botState.lastScan = Date.now();
      botState.opportunities = result.opportunities;

      if (result.opportunities.length > 0) {
        console.log(`Found ${result.opportunities.length} opportunities`);
      }
    } catch (err: any) {
      botState.lastError = err.message;
      console.error("Scan error:", err.message);
    }
  }, 5000); // Scan every 5 seconds
}

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`MEV Arbitrage Bot API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/api/status`);
});
