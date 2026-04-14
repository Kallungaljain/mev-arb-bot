// ─── Keeper Context ───────────────────────────────────────────────────────────
//
// Manages the connection to the production Keeper service and syncs all state.

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { KeeperApiClient, KeeperWsClient, BotStatus, Opportunity, TradeRecord } from "./keeper-api";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface KeeperContextValue {
  // Connection
  connected: boolean;
  connectionError: string | null;
  baseUrl: string;
  wsSecret: string;

  // State
  status: BotStatus | null;
  opportunities: Opportunity[];
  history: TradeRecord[];

  // Actions
  connect: (baseUrl: string, wsSecret: string) => Promise<void>;
  disconnect: () => void;
  startBot: () => Promise<void>;
  stopBot: () => Promise<void>;
  setAutoExecute: (enabled: boolean) => Promise<void>;
  executeOpportunity: (opp: Opportunity) => Promise<void>;
  getWalletBalance: () => Promise<{ matic: string; address: string }>;
  refreshStatus: () => Promise<void>;
  refreshHistory: () => Promise<void>;
}

const KeeperContext = createContext<KeeperContextValue | null>(null);

export function KeeperProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [wsSecret, setWsSecret] = useState("");
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [history, setHistory] = useState<TradeRecord[]>([]);

  const apiRef = useRef<KeeperApiClient | null>(null);
  const wsRef = useRef<KeeperWsClient | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved connection from storage
  useEffect(() => {
    (async () => {
      const savedUrl = await AsyncStorage.getItem("keeper_base_url");
      const savedSecret = await AsyncStorage.getItem("keeper_ws_secret");

      if (savedUrl && savedSecret) {
        setBaseUrl(savedUrl);
        setWsSecret(savedSecret);
        // Auto-connect if previously connected
        await connectInternal(savedUrl, savedSecret);
      }
    })();
  }, []);

  const connectInternal = async (url: string, secret: string) => {
    try {
      setConnectionError(null);
      const api = new KeeperApiClient(url, secret);
      const ws = new KeeperWsClient(url, secret);

      // Test REST connection
      const testStatus = await api.getStatus();
      setStatus(testStatus);

      // Connect WebSocket
      await ws.connect();

      // Set up WebSocket listeners
      ws.on("opportunity", (msg) => {
        if (msg.type === "opportunity") {
          setOpportunities((prev) => [msg.data, ...prev].slice(0, 50));
        }
      });

      ws.on("trade_update", (msg) => {
        if (msg.type === "trade_update") {
          setHistory((prev) => [msg.data, ...prev].slice(0, 200));
        }
      });

      ws.on("status", (msg) => {
        if (msg.type === "status") {
          setStatus(msg.data);
        }
      });

      ws.on("error", (msg) => {
        if (msg.type === "error") {
          setConnectionError(msg.message);
        }
      });

      apiRef.current = api;
      wsRef.current = ws;
      setConnected(true);

      // Save connection details
      await AsyncStorage.setItem("keeper_base_url", url);
      await AsyncStorage.setItem("keeper_ws_secret", secret);

      // Poll status every 10 seconds (fallback if WS updates lag)
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      statusPollRef.current = setInterval(async () => {
        try {
          const newStatus = await api.getStatus();
          setStatus(newStatus);
        } catch (err) {
          // Silent fail — WS updates are primary
        }
      }, 10000);
    } catch (err: any) {
      const msg = err?.message ?? "Connection failed";
      setConnectionError(msg);
      setConnected(false);
    }
  };

  const connect = async (url: string, secret: string) => {
    await connectInternal(url, secret);
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    apiRef.current = null;
    setConnected(false);
    setStatus(null);
    setOpportunities([]);
    setHistory([]);
    AsyncStorage.removeItem("keeper_base_url");
    AsyncStorage.removeItem("keeper_ws_secret");
  };

  const startBot = async () => {
    if (!apiRef.current) throw new Error("Not connected");
    await apiRef.current.startBot();
  };

  const stopBot = async () => {
    if (!apiRef.current) throw new Error("Not connected");
    await apiRef.current.stopBot();
  };

  const setAutoExecute = async (enabled: boolean) => {
    if (!apiRef.current) throw new Error("Not connected");
    await apiRef.current.setAutoExecute(enabled);
  };

  const executeOpportunity = async (opp: Opportunity) => {
    if (!apiRef.current) throw new Error("Not connected");
    await apiRef.current.executeOpportunity(opp);
  };

  const getWalletBalance = async () => {
    if (!apiRef.current) throw new Error("Not connected");
    return apiRef.current.getWalletBalance();
  };

  const refreshStatus = async () => {
    if (!apiRef.current) throw new Error("Not connected");
    const newStatus = await apiRef.current.getStatus();
    setStatus(newStatus);
  };

  const refreshHistory = async () => {
    if (!apiRef.current) throw new Error("Not connected");
    const newHistory = await apiRef.current.getHistory(100);
    setHistory(newHistory);
  };

  const value: KeeperContextValue = {
    connected,
    connectionError,
    baseUrl,
    wsSecret,
    status,
    opportunities,
    history,
    connect,
    disconnect,
    startBot,
    stopBot,
    setAutoExecute,
    executeOpportunity,
    getWalletBalance,
    refreshStatus,
    refreshHistory,
  };

  return <KeeperContext.Provider value={value}>{children}</KeeperContext.Provider>;
}

export function useKeeper() {
  const ctx = useContext(KeeperContext);
  if (!ctx) throw new Error("useKeeper must be used inside KeeperProvider");
  return ctx;
}
