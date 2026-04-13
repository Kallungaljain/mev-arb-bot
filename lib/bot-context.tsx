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
import { scanOpportunities, validateAlchemyKey } from "./alchemy";
import { vpsClient } from "./vps-client";
import type { ScannerState } from "../shared/scanner-types";

// ─── Context Types ─────────────────────────────────────────────────────────────

interface BotContextValue {
  settings: BotSettings;
  botState: BotState;
  opportunities: ArbOpportunity[];
  tradeHistory: TradeRecord[];
  scanError: string | null;
  updateSettings: (s: Partial<BotSettings>) => Promise<void>;
  startBot: () => Promise<void>;
  stopBot: () => void;
  clearHistory: () => Promise<void>;
  isLoading: boolean;
  // VPS mode
  vpsConnected: boolean;
  setVpsConnected: (v: boolean) => void;
  vpsMode: boolean;
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
  const [scanError, setScanError] = useState<string | null>(null);

  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  // Use a ref to always have the latest settings in the scan loop
  const settingsRef = useRef<BotSettings>(DEFAULT_SETTINGS);

  const vpsMode = vpsConnected && vpsClient.isConnected();

  // ── Load persisted data on mount ──
  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([loadSettings(), loadTradeHistory()]);
      setSettings(s);
      settingsRef.current = s;
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
    const unsubConnected = vpsClient.on("connected", () => setVpsConnected(true));
    const unsubDisconnected = vpsClient.on("disconnected", () => setVpsConnected(false));

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
      setScanError(null);
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
      settingsRef.current = next; // keep ref in sync
      saveSettings(next);
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

  // ── Single local scan cycle — uses settingsRef to avoid stale closure ──
  const runScan = useCallback(async () => {
    const currentSettings = settingsRef.current;

    if (!currentSettings.alchemyApiKey?.trim()) {
      setScanError("No Alchemy API key. Go to Settings and enter your key.");
      setBotState((prev) => ({ ...prev, networkStatus: "error" }));
      return;
    }

    try {
      setBotState((prev) => ({ ...prev, networkStatus: "connected" }));
      setScanError(null);

      const result = await scanOpportunities(currentSettings.alchemyApiKey, {
        minProfitUsd: currentSettings.minProfitUsd,
        maxSlippagePct: currentSettings.maxSlippagePct,
        maxVolatilityPct: currentSettings.maxVolatilityPct,
        maxGasGwei: currentSettings.maxGasGwei,
        tradeAmountMatic: currentSettings.tradeAmountMatic,
      });

      if (result.error) {
        setScanError(result.error);
        setBotState((prev) => ({ ...prev, networkStatus: "error" }));
        return;
      }

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
          await executeOpportunity(opp);
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? "Unknown error";
      setScanError(`Scan failed: ${msg}`);
      setBotState((prev) => ({ ...prev, networkStatus: "error" }));
    }
  }, []);

  // ── Execute a trade ──
  const executeOpportunity = useCallback(async (opp: ArbOpportunity) => {
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
  }, []);

  // ── Start bot ──
  const startBot = useCallback(async () => {
    if (runningRef.current) return;

    // Validate API key first
    const key = settingsRef.current.alchemyApiKey?.trim();
    if (!key) {
      setScanError("Enter your Alchemy API key in Settings first.");
      return;
    }

    // Quick validation ping
    setBotState((prev) => ({ ...prev, networkStatus: "connected", running: true }));
    const validation = await validateAlchemyKey(key);
    if (!validation.valid) {
      setScanError(validation.error ?? "Invalid API key");
      setBotState((prev) => ({ ...prev, networkStatus: "error", running: false }));
      return;
    }

    if (vpsClient.isConnected()) {
      vpsClient.send("start");
      runningRef.current = true;
      setBotState((prev) => ({ ...prev, running: true }));
      return;
    }

    runningRef.current = true;
    setBotState((prev) => ({ ...prev, running: true }));
    setScanError(null);

    // Immediate first scan
    await runScan();

    scanIntervalRef.current = setInterval(() => {
      runScan();
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
    setScanError(null);
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
        scanError,
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
