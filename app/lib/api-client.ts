import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BotStatus {
  isRunning: boolean;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  lastTrade: number | null;
  lastError: string | null;
  lastScan: number | null;
  opportunities: any[];
  uptime: number;
}

export interface Opportunity {
  id: string;
  path: string[];
  profit_usd: number;
  slippage_pct: number;
  mev_risk_score: number;
  liquidity_usd: number;
}

class ApiClient {
  private baseUrl: string;
  private apiKey: string | null = null;
  private privateKey: string | null = null;

  constructor() {
    this.baseUrl = API_BASE_URL;
    this.loadCredentials();
  }

  private async loadCredentials() {
    try {
      this.apiKey = await AsyncStorage.getItem("alchemy_api_key");
      this.privateKey = await AsyncStorage.getItem("private_key");
    } catch (err) {
      console.error("Failed to load credentials:", err);
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: any
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const options: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err: any) {
      console.error(`API request failed: ${endpoint}`, err);
      throw err;
    }
  }

  // ─── Health Check ────────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.makeRequest<any>("/health");
      return response.status === "ok";
    } catch {
      return false;
    }
  }

  // ─── Validate Alchemy Key ────────────────────────────────────────────────────

  async validateAlchemyKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await this.makeRequest<any>("/api/validate-alchemy", "POST", { apiKey });
      return {
        valid: response.valid === true,
        error: response.error,
      };
    } catch (err: any) {
      return {
        valid: false,
        error: err.message || "Validation failed",
      };
    }
  }

  // ─── Get Bot Status ───────────────────────────────────────────────────────────

  async getStatus(): Promise<BotStatus | null> {
    try {
      const response = await this.makeRequest<any>("/api/status");
      return {
        isRunning: response.isRunning || false,
        totalTrades: response.totalTrades || 0,
        successfulTrades: response.successfulTrades || 0,
        failedTrades: response.failedTrades || 0,
        totalProfit: response.totalProfit || 0,
        lastTrade: response.lastTrade || null,
        lastError: response.lastError || null,
        lastScan: response.lastScan || null,
        opportunities: response.opportunities || [],
        uptime: response.uptime || 0,
      };
    } catch (err) {
      console.error("Failed to get status:", err);
      return null;
    }
  }

  // ─── Get Opportunities ────────────────────────────────────────────────────────

  async getOpportunities(): Promise<Opportunity[]> {
    try {
      const response = await this.makeRequest<any>("/api/opportunities");
      return Array.isArray(response.opportunities) ? response.opportunities : [];
    } catch (err) {
      console.error("Failed to get opportunities:", err);
      return [];
    }
  }

  // ─── Scan for Opportunities ──────────────────────────────────────────────────

  async scan(settings?: any): Promise<{ opportunities: Opportunity[]; gasGwei: number; maticPriceUsd: number }> {
    if (!this.apiKey) {
      throw new Error("Alchemy API key not set");
    }

    try {
      return await this.makeRequest<any>("/api/scan", "POST", {
        apiKey: this.apiKey,
        settings: settings || {
          minProfitUsd: 5,
          maxSlippagePct: 0.5,
          maxVolatilityPct: 5,
          maxGasGwei: 100,
          tradeAmountMatic: 1,
        },
      });
    } catch (err: any) {
      console.error("Scan failed:", err);
      throw err;
    }
  }

  // ─── Start Bot ────────────────────────────────────────────────────────────────

  async startBot(): Promise<boolean> {
    if (!this.apiKey) {
      throw new Error("Alchemy API key not set");
    }

    try {
      const response = await this.makeRequest<any>("/api/bot/start", "POST", {
        apiKey: this.apiKey,
      });
      return response.status === "started" || response.ok === true;
    } catch (err) {
      console.error("Failed to start bot:", err);
      return false;
    }
  }

  // ─── Stop Bot ─────────────────────────────────────────────────────────────────

  async stopBot(): Promise<boolean> {
    try {
      const response = await this.makeRequest<any>("/api/bot/stop", "POST", {});
      return response.status === "stopped" || response.ok === true;
    } catch (err) {
      console.error("Failed to stop bot:", err);
      return false;
    }
  }

  // ─── Execute Trade ───────────────────────────────────────────────────────────

  async executeTrade(opportunity: Opportunity): Promise<any> {
    if (!this.apiKey || !this.privateKey) {
      throw new Error("API key or private key not set");
    }

    try {
      return await this.makeRequest<any>("/api/execute-trade", "POST", {
        apiKey: this.apiKey,
        privateKey: this.privateKey,
        opportunity,
      });
    } catch (err: any) {
      console.error("Trade execution failed:", err);
      throw err;
    }
  }

  // ─── Set Credentials ──────────────────────────────────────────────────────────

  async setCredentials(apiKey: string, privateKey: string) {
    try {
      await AsyncStorage.setItem("alchemy_api_key", apiKey);
      await AsyncStorage.setItem("private_key", privateKey);
      this.apiKey = apiKey;
      this.privateKey = privateKey;
    } catch (err) {
      console.error("Failed to save credentials:", err);
      throw err;
    }
  }

  // ─── Get Credentials ──────────────────────────────────────────────────────────

  async getCredentials(): Promise<{ apiKey: string | null; privateKey: string | null }> {
    try {
      const apiKey = await AsyncStorage.getItem("alchemy_api_key");
      const privateKey = await AsyncStorage.getItem("private_key");
      return { apiKey, privateKey };
    } catch (err) {
      console.error("Failed to get credentials:", err);
      return { apiKey: null, privateKey: null };
    }
  }
}

export const apiClient = new ApiClient();
