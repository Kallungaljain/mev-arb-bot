// ─── Keeper API Client ────────────────────────────────────────────────────────
//
// Communicates with the production Keeper service running on the VPS.
// Handles REST calls for status, opportunities, history, and manual execution.

import { z } from "zod";

// ── Types (matching keeper/src/types.ts) ──────────────────────────────────────

export interface Opportunity {
  pair_name: string;
  buy_dex: string;
  sell_dex: string;
  buy_dex_addr: string;
  sell_dex_addr: string;
  loan_token: string;
  profit_token: string;
  loan_amount_raw: string;
  spread_pct: number;
  slippage_pct: number;
  gas_cost_usd: number;
  gross_profit_usd: number;
  net_profit_usd: number;
  confidence: number;
  timestamp_ms: number;
}

export interface TradeRecord {
  id: string;
  opportunity: Opportunity;
  status: "pending" | "submitted" | "confirmed" | "failed" | "skipped";
  txHash?: string;
  actualProfitUsd?: number;
  gasUsed?: number;
  gasCostUsd?: number;
  errorMessage?: string;
  createdAt: number;
  confirmedAt?: number;
  skipReason?: string;
}

export interface BotStatus {
  running: boolean;
  autoExecute: boolean;
  scanCount: number;
  opportunityCount: number;
  executedCount: number;
  failedCount: number;
  totalProfitUsd: number;
  totalGasCostUsd: number;
  gasPrice: number;
  maticPrice: number;
  uptime: number;
  contractAddress: string;
  profitWallet: string;
}

// ── API Client ────────────────────────────────────────────────────────────────

export class KeeperApiClient {
  private baseUrl: string;
  private wsSecret: string;

  constructor(baseUrl: string, wsSecret: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.wsSecret = wsSecret;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-WS-Secret": this.wsSecret,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getStatus(): Promise<BotStatus> {
    return this.request<BotStatus>("GET", "/api/status");
  }

  async getOpportunities(): Promise<Opportunity[]> {
    return this.request<Opportunity[]>("GET", "/api/opportunities");
  }

  async getHistory(limit: number = 50): Promise<TradeRecord[]> {
    return this.request<TradeRecord[]>("GET", `/api/history?limit=${limit}`);
  }

  async startBot(): Promise<{ success: boolean; running: boolean }> {
    return this.request("POST", "/api/bot/start");
  }

  async stopBot(): Promise<{ success: boolean; running: boolean }> {
    return this.request("POST", "/api/bot/stop");
  }

  async setAutoExecute(enabled: boolean): Promise<{ success: boolean; autoExecute: boolean }> {
    return this.request("POST", "/api/bot/auto-execute", { enabled });
  }

  async executeOpportunity(opp: Opportunity): Promise<{ success: boolean; trade?: TradeRecord; reason?: string }> {
    return this.request("POST", "/api/execute", opp);
  }

  async getWalletBalance(): Promise<{ matic: string; address: string }> {
    return this.request("GET", "/api/wallet");
  }

  async healthCheck(): Promise<{ status: string; uptime: number }> {
    return this.request("GET", "/health");
  }
}

// ── WebSocket Client ──────────────────────────────────────────────────────────

export type WsMessage =
  | { type: "opportunity"; data: Opportunity }
  | { type: "trade_update"; data: TradeRecord }
  | { type: "status"; data: BotStatus }
  | { type: "error"; message: string }
  | { type: "pong" };

export class KeeperWsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private wsSecret: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  private listeners: Map<string, ((msg: WsMessage) => void)[]> = new Map();

  constructor(baseUrl: string, wsSecret: string) {
    const wsUrl = baseUrl
      .replace(/^http/, "ws")
      .replace(/\/$/, "");
    this.url = `${wsUrl}/ws?secret=${encodeURIComponent(wsSecret)}`;
    this.wsSecret = wsSecret;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log("✅ Keeper WebSocket connected");
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as WsMessage;
            this.emit(msg.type, msg);
          } catch (err) {
            console.error("Failed to parse WS message:", err);
          }
        };

        this.ws.onerror = (err) => {
          console.error("WebSocket error:", err);
          reject(err);
        };

        this.ws.onclose = () => {
          console.log("WebSocket closed, attempting reconnect...");
          this.stopHeartbeat();
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnect attempts reached");
      this.emit("error", { type: "error", message: "Connection lost" });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("Reconnect failed:", err);
      });
    }, delay);
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  on(type: string, callback: (msg: WsMessage) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(callback);
  }

  off(type: string, callback: (msg: WsMessage) => void) {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  private emit(type: string, msg: WsMessage) {
    const list = this.listeners.get(type) ?? [];
    for (const callback of list) {
      callback(msg);
    }
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
