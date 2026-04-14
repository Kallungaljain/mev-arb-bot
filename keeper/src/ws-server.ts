// ─── WebSocket Push Server ────────────────────────────────────────────────────
//
// Broadcasts real-time updates to connected Android app clients.
// Messages: opportunity_detected, trade_submitted, trade_confirmed, status_update

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { BotStatus, Opportunity, TradeRecord } from "./types";

type WsMessage =
  | { type: "opportunity"; data: Opportunity }
  | { type: "trade_update"; data: TradeRecord }
  | { type: "status"; data: BotStatus }
  | { type: "error"; message: string }
  | { type: "pong" };

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server, private secret: string) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      // Auth check via query param: ?secret=xxx
      const url = new URL(req.url ?? "/", "http://localhost");
      const clientSecret = url.searchParams.get("secret");

      if (clientSecret !== this.secret) {
        ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        ws.close(1008, "Unauthorized");
        return;
      }

      this.clients.add(ws);
      console.log(`WS client connected (${this.clients.size} total)`);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch { /* ignore */ }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`WS client disconnected (${this.clients.size} remaining)`);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(msg: WsMessage) {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  broadcastOpportunity(opp: Opportunity) {
    this.broadcast({ type: "opportunity", data: opp });
  }

  broadcastTradeUpdate(trade: TradeRecord) {
    this.broadcast({ type: "trade_update", data: trade });
  }

  broadcastStatus(status: BotStatus) {
    this.broadcast({ type: "status", data: status });
  }

  get clientCount() {
    return this.clients.size;
  }
}
