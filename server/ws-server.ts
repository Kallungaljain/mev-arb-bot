/**
 * WebSocket Push Server
 *
 * Broadcasts real-time scanner updates to all connected Android clients.
 * Messages are JSON with a `type` field:
 *   { type: "state",         data: ScannerState }
 *   { type: "opportunities", data: ArbOpportunity[] }
 *   { type: "trade",         data: TradeRecord }
 *   { type: "ping" }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { scanner } from "./bot-router";

export function registerWebSocketServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });

  const broadcast = (type: string, data: unknown) => {
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  };

  // Forward scanner events to all connected clients
  scanner.on("state", (data) => broadcast("state", data));
  scanner.on("opportunities", (data) => broadcast("opportunities", data));
  scanner.on("trade", (data) => broadcast("trade", data));
  scanner.on("error", (msg) => broadcast("error", { message: msg }));

  wss.on("connection", (ws) => {
    console.log(`[ws] Client connected. Total: ${wss.clients.size}`);

    // Send current state immediately on connect
    const state = scanner.getState();
    ws.send(JSON.stringify({ type: "state", data: state, ts: Date.now() }));
    ws.send(JSON.stringify({ type: "opportunities", data: state.opportunities, ts: Date.now() }));

    // Heartbeat ping every 30s to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Handle pong from client
        if (msg.type === "pong") return;
        // Handle settings update from app
        if (msg.type === "updateSettings" && msg.data) {
          scanner.updateSettings(msg.data);
        }
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      console.log(`[ws] Client disconnected. Total: ${wss.clients.size}`);
    });

    ws.on("error", (err) => {
      console.error("[ws] Client error:", err.message);
    });
  });

  console.log("[ws] WebSocket push server registered at /api/ws");
}
