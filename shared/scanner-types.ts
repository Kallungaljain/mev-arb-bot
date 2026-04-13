// ─── Shared Types ─────────────────────────────────────────────────────────────
// This file is imported by BOTH the server (scanner.ts) and the React Native app.
// It must NEVER import from server/** or any Node.js-only packages.

export interface ScannerState {
  running: boolean;
  scanCount: number;
  lastEventAt: number;
  gasGwei: number;
  maticPriceUsd: number;
  networkStatus: "connected" | "disconnected" | "error";
}

export interface WsMessage {
  type: "state" | "opportunities" | "trade" | "error" | "ping" | "pong";
  data?: unknown;
}
