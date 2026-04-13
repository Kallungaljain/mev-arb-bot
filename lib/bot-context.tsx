import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  BotSettings,
  BotState,
  TradeRecord,
  ArbOpportunity,
  DEFAULT_SETTINGS,
  DEFAULT_BOT_STATE,
  loadSettings,
  saveSettings,
  loadTradeHistory,
  appendTrade,
  clearTradeHistory,
} from "./bot-store";
import { scanOpportunities } from "./alchemy";

// ─── Context Types ─────────────────────────────────────────────────────────────

interface BotContextValue {
  settings: BotSettings;
  botState: BotState;
  opportunities: ArbOpportunity[];
  tradeHistory: TradeRecord[];
  updateSettings: (s: Partial<BotSettings>) => Promise<void>;
  startBot: () => void;
  stopBot: () => void;
  clearHistory: () => Promise<void>;
  isLoading: boolean;
}

const BotContext = createContext<BotContextValue | null>(null);

export function useBotContext(): BotContextValue {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error("useBotContext must be used inside BotProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 15_000; // scan every 15 seconds

export function BotProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [botState, setBotState] = useState<BotState>(DEFAULT_BOT_STATE);
  const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  // ── Load persisted data on mount ──
  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([loadSettings(), loadTradeHistory()]);
      setSettings(s);
      setTradeHistory(h);
      setIsLoading(false);
    })();
  }, []);

  // ── Settings update ──
  const updateSettings = useCallback(async (partial: Partial<BotSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, []);

  // ── Single scan cycle ──
  const runScan = useCallback(async (currentSettings: BotSettings) => {
    if (!currentSettings.alchemyApiKey) {
      setBotState((prev) => ({ ...prev, networkStatus: "error" }));
      return;
    }
    try {
      setBotState((prev) => ({ ...prev, networkStatus: "connected" }));
      const result = await scanOpportunities(currentSettings.alchemyApiKey, {
        minProfitUsd: currentSettings.minProfitUsd,
        maxSlippagePct: currentSettings.maxSlippagePct,
        maxVolatilityPct: currentSettings.maxVolatilityPct,
        maxGasGwei: currentSettings.maxGasGwei,
        tradeAmountMatic: currentSettings.tradeAmountMatic,
      });

      setOpportunities(result.opportunities);
      setBotState((prev) => ({
        ...prev,
        scanCount: prev.scanCount + 1,
        lastScanAt: Date.now(),
        gasGwei: result.gasGwei,
        maticPriceUsd: result.maticPriceUsd,
        networkStatus: "connected",
      }));

      // Auto-execute safe opportunities if enabled
      if (currentSettings.autoExecute && currentSettings.privateKey) {
        for (const opp of result.opportunities) {
          if (!opp.safe) continue;
          await executeOpportunity(opp, currentSettings);
        }
      }
    } catch (err) {
      setBotState((prev) => ({ ...prev, networkStatus: "error" }));
    }
  }, []);

  // ── Execute a trade (simulated — real tx requires ethers.js on-device) ──
  const executeOpportunity = useCallback(
    async (opp: ArbOpportunity, currentSettings: BotSettings) => {
      const trade: TradeRecord = {
        id: `trade-${Date.now()}`,
        opportunity: opp,
        status: "pending",
        executedAt: Date.now(),
      };

      // In production this would call the flash loan contract via ethers.js
      // For now we simulate success/failure based on confidence score
      const success = opp.confidence > 60 && Math.random() > 0.15;

      const finalTrade: TradeRecord = {
        ...trade,
        status: success ? "success" : "failed",
        actualProfitUsd: success ? opp.netProfitUsd * (0.85 + Math.random() * 0.3) : 0,
        gasUsedUsd: opp.gasCostUsd * (0.9 + Math.random() * 0.2),
        txHash: success ? `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}` : undefined,
        errorMsg: !success ? "Execution reverted: insufficient output amount" : undefined,
      };

      await appendTrade(finalTrade);
      setTradeHistory((prev) => [finalTrade, ...prev].slice(0, 500));

      setBotState((prev) => ({
        ...prev,
        totalProfitUsd: prev.totalProfitUsd + (finalTrade.actualProfitUsd ?? 0),
        totalGasUsd: prev.totalGasUsd + (finalTrade.gasUsedUsd ?? 0),
        successTrades: prev.successTrades + (success ? 1 : 0),
        failedTrades: prev.failedTrades + (!success ? 1 : 0),
      }));
    },
    []
  );

  // ── Start bot ──
  const startBot = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBotState((prev) => ({ ...prev, running: true }));

    // Immediate first scan
    setSettings((currentSettings) => {
      runScan(currentSettings);
      return currentSettings;
    });

    scanIntervalRef.current = setInterval(() => {
      setSettings((currentSettings) => {
        runScan(currentSettings);
        return currentSettings;
      });
    }, SCAN_INTERVAL_MS);
  }, [runScan]);

  // ── Stop bot ──
  const stopBot = useCallback(() => {
    runningRef.current = false;
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setBotState((prev) => ({ ...prev, running: false, networkStatus: "disconnected" }));
  }, []);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, []);

  // ── Clear history ──
  const clearHistory = useCallback(async () => {
    await clearTradeHistory();
    setTradeHistory([]);
  }, []);

  return (
    <BotContext.Provider
      value={{
        settings,
        botState,
        opportunities,
        tradeHistory,
        updateSettings,
        startBot,
        stopBot,
        clearHistory,
        isLoading,
      }}
    >
      {children}
    </BotContext.Provider>
  );
}
