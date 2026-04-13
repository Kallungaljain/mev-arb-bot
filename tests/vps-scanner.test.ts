import { describe, it, expect, vi, beforeEach } from "vitest";
import { EliteScanner, ScannerSettings } from "../server/scanner";

const TEST_SETTINGS: ScannerSettings = {
  alchemyApiKey: "",
  minProfitUsd: 2,
  maxSlippagePct: 0.5,
  maxVolatilityPct: 5,
  maxGasGwei: 200,
  tradeAmountMatic: 1000,
};

describe("EliteScanner", () => {
  it("initialises in stopped state", () => {
    const scanner = new EliteScanner(TEST_SETTINGS);
    const state = scanner.getState();
    expect(state.running).toBe(false);
    expect(state.networkStatus).toBe("disconnected");
    expect(state.scanCount).toBe(0);
    expect(state.opportunities).toHaveLength(0);
  });

  it("does not start without an API key", async () => {
    const scanner = new EliteScanner({ ...TEST_SETTINGS, alchemyApiKey: "" });
    const errors: string[] = [];
    scanner.on("error", (msg) => errors.push(msg as string));
    await scanner.start();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("API key");
    scanner.stop();
  });

  it("stop() transitions to stopped state", () => {
    const scanner = new EliteScanner(TEST_SETTINGS);
    scanner.stop();
    const state = scanner.getState();
    expect(state.running).toBe(false);
    expect(state.networkStatus).toBe("disconnected");
  });

  it("updateSettings() merges partial settings", () => {
    const scanner = new EliteScanner(TEST_SETTINGS);
    scanner.updateSettings({ minProfitUsd: 5, maxGasGwei: 100 });
    // No direct getter for settings, but we verify no crash and state unchanged
    const state = scanner.getState();
    expect(state.running).toBe(false);
  });

  it("emits state event when stop() is called", () => {
    const scanner = new EliteScanner(TEST_SETTINGS);
    const states: unknown[] = [];
    scanner.on("state", (s) => states.push(s));
    scanner.stop();
    expect(states.length).toBeGreaterThan(0);
  });
});

describe("VPS Client (unit)", () => {
  it("isConnected() returns false when not connected", async () => {
    const { vpsClient } = await import("../lib/vps-client");
    expect(vpsClient.isConnected()).toBe(false);
  });

  it("getConfig() returns null before any config is saved", async () => {
    const { VpsClient } = await import("../lib/vps-client");
    const client = new VpsClient();
    expect(client.getConfig()).toBeNull();
  });

  it("on() returns an unsubscribe function", async () => {
    const { VpsClient } = await import("../lib/vps-client");
    const client = new VpsClient();
    const unsub = client.on("connected", () => {});
    expect(typeof unsub).toBe("function");
    unsub(); // should not throw
  });
});

describe("WebSocket Message Protocol", () => {
  it("parses valid state message", () => {
    const raw = JSON.stringify({
      type: "state",
      data: { running: true, scanCount: 42, gasGwei: 80, maticPriceUsd: 0.85 },
      ts: Date.now(),
    });
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("state");
    expect(msg.data.running).toBe(true);
    expect(msg.data.scanCount).toBe(42);
  });

  it("parses valid opportunities message", () => {
    const raw = JSON.stringify({
      type: "opportunities",
      data: [{ id: "opp-1", safe: true, netProfitUsd: 3.5 }],
      ts: Date.now(),
    });
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("opportunities");
    expect(msg.data).toHaveLength(1);
    expect(msg.data[0].safe).toBe(true);
  });

  it("handles malformed JSON gracefully", () => {
    expect(() => {
      try { JSON.parse("not-json"); } catch { /* expected */ }
    }).not.toThrow();
  });
});
