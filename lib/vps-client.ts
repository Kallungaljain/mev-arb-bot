/**
 * VPS Client — Android App Side
 *
 * Connects the Android app to the VPS backend via WebSocket.
 * Receives real-time scanner state + opportunity updates pushed from the VPS.
 * Falls back to local scanner mode if no VPS is configured.
 *
 * Message protocol (same as ws-server.ts):
 *   { type: "state",         data: ScannerState }
 *   { type: "opportunities", data: ArbOpportunity[] }
 *   { type: "trade",         data: TradeRecord }
 *   { type: "ping" }
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ScannerState } from "../server/scanner";
import type { ArbOpportunity, TradeRecord } from "./bot-store";

export interface VpsConfig {
  url: string;       // e.g. "ws://123.45.67.89:3000/api/ws"
  apiSecret: string; // shared secret for basic auth
}

type VpsEventType = "state" | "opportunities" | "trade" | "ping" | "error" | "connected" | "disconnected";
type VpsListener = (data: unknown) => void;

const STORAGE_KEY = "vps_config";

export class VpsClient {
  private ws: WebSocket | null = null;
  private config: VpsConfig | null = null;
  private listeners: Map<VpsEventType, Set<VpsListener>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;
  private maxReconnectDelay = 30_000;
  private intentionallyClosed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // ── Config persistence ─────────────────────────────────────────────────────

  async loadConfig(): Promise<VpsConfig | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.config = JSON.parse(raw);
        return this.config;
      }
    } catch { /* ignore */ }
    return null;
  }

  async saveConfig(config: VpsConfig): Promise<void> {
    this.config = config;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  async clearConfig(): Promise<void> {
    this.config = null;
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  getConfig(): VpsConfig | null {
    return this.config;
  }

  // ── Connect ────────────────────────────────────────────────────────────────

  connect(config?: VpsConfig): void {
    if (config) this.config = config;
    if (!this.config?.url) return;

    this.intentionallyClosed = false;
    this.reconnectDelay = 3000;
    this._connect();
  }

  private _connect(): void {
    if (!this.config?.url) return;

    try {
      // Append API secret as query param for simple auth
      const url = this.config.apiSecret
        ? `${this.config.url}?secret=${encodeURIComponent(this.config.apiSecret)}`
        : this.config.url;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log("[vps] Connected to VPS scanner");
        this.reconnectDelay = 3000; // reset backoff
        this.emit("connected", { url: this.config!.url });

        // Heartbeat pong
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "pong" }));
          }
        }, 30_000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type) this.emit(msg.type as VpsEventType, msg.data);
        } catch { /* ignore */ }
      };

      this.ws.onerror = (err) => {
        console.error("[vps] WebSocket error:", err);
        this.emit("error", err);
      };

      this.ws.onclose = () => {
        this._clearPing();
        if (!this.intentionallyClosed) {
          this.emit("disconnected", null);
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error("[vps] Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────

  disconnect(): void {
    this.intentionallyClosed = true;
    this._clearReconnect();
    this._clearPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emit("disconnected", null);
  }

  // ── Send command to VPS ────────────────────────────────────────────────────

  send(type: string, data?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Event emitter ──────────────────────────────────────────────────────────

  on(event: VpsEventType, listener: VpsListener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private emit(event: VpsEventType, data: unknown): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  // ── Reconnect with exponential backoff ────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionallyClosed) return;
    console.log(`[vps] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private _clearPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}

// Singleton instance shared across the app
export const vpsClient = new VpsClient();
