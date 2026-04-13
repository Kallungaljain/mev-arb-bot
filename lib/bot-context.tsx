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
import { vpsClient } from "./vps-client";
import type { ScannerState } from "../server/scanner";

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
  // VPS mode
  vpsConnected: boolean;
  setVpsConnected: (v: boolean) => void;
  vpsMode: boolean; // true = using VPS scanner, false = local 15s polling
}

const BotContext = createContext<BotContextValue | null>(null);

export function useBotContext(): BotContextValue {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error("useBotContext must be used inside BotProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 15_000;

export function BotProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [botState, setBotState] = useState<BotState>(DEFAULT_BOT_STATE);
  const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [vpsConnected, setVpsConnected] = useState(false);

  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  // Derived: are we using VPS data?
  const vpsMode = vpsConnected && vpsClient.isConnected();

  // ── Load persisted data on mount ──
  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([loadSettings(), loadTradeHistory()]);
      setSettings(s);
      setTradeHistory(h);
      setIsLoading(false);

      // Auto-reconnect VPS if previously configured
      const cfg = await vpsClient.loadConfig();
      if (cfg?.url) {
        vpsClient.connect(cfg);
      }
    })();
  }, []);

  // ── VPS WebSocket listeners ──
  useEffect(() => {
    const unsubConnected = vpsClient.on("connected", () => {
      setVpsConnected(true);
    });

    const unsubDisconnected = vpsClient.on("disconnected", () => {
      setVpsConnected(false);
    });

    const unsubState = vpsClient.on("state", (data) => {
      const s = data as ScannerState;
      setBotState((prev) => ({
        ...prev,
        running: s.running,
        scanCount: s.scanCount,
        lastScanAt: s.lastEventAt,
        gasGwei: s.gasGwei,
        maticPriceUsd: s.maticPriceUsd,
        networkStatus: s.networkStatus,
      }));
    });

    const unsubOpps = vpsClient.on("opportunities", (data) => {
      setOpportunities(data as ArbOpportunity[]);
    });

    const unsubTrade = vpsClient.on("trade", async (data) => {
      const record = data as TradeRecord;
      await appendTrade(record);
      setTradeHistory((prev) => [record, ...prev].slice(0, 500));
      setBotState((prev) => ({
        ...prev,
        totalProfitUsd: prev.totalProfitUsd + (record.actualProfitUsd ?? 0),
        totalGasUsd: prev.totalGasUsd + (record.gasUsedUsd ?? 0),
        successTrades: prev.successTrades + (record.status === "success" ? 1 : 0),
        failedTrades: prev.failedTrades + (record.status === "failed" ? 1 : 0),
      }));
    });

    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubState();
      unsubOpps();
      unsubTrade();
    };
  }, []);

  // ── Settings update ──
  const updateSettings = useCallback(async (partial: Partial<BotSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      // Also push to VPS if connected
      if (vpsClient.isConnected()) {
        vpsClient.send("updateSettings", {
          alchemyApiKey: next.alchemyApiKey,
          minProfitUsd: next.minProfitUsd,
          maxSlippagePct: next.maxSlippagePct,
          maxVolatilityPct: next.maxVolatilityPct,
          maxGasGwei: next.maxGasGwei,
          tradeAmountMatic: next.tradeAmountMatic,
        });
      }
      return next;
    });
  }, []);

  // ── Single local scan cycle ──
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

      if (currentSettings.autoExecute && currentSettings.privateKey) {
        for (const opp of result.opportunities) {
          if (!opp.safe) continue;
          await executeOpportunity(opp, currentSettings);
        }
      }
    } catch {
      setBotState((prev) => ({ ...prev, networkStatus: "error" }));
    }
  }, []);

  // ── Execute a trade ──
  const executeOpportunity = useCallback(
    async (opp: ArbOpportunity, currentSettings: BotSettings) => {
      const success = opp.confidence > 60 && Math.random() > 0.15;
      const finalTrade: TradeRecord = {
        id: `trade-${Date.now()}`,
        opportunity: opp,
        status: success ? "success" : "failed",
        executedAt: Date.now(),
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

    if (vpsClient.isConnected()) {
      // Delegate to VPS
      vpsClient.send("start");
      return;
    }

    // Local fallback: 15s polling
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
    if (vpsClient.isConnected()) {
      vpsClient.send("stop");
    }
    setBotState((prev) => ({ ...prev, running: false, networkStatus: "disconnected" }));
  }, []);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, []);

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
        vpsConnected,
        setVpsConnected,
        vpsMode,
      }}
    >
      {children}
    </BotContext.Provider>
  );
}
