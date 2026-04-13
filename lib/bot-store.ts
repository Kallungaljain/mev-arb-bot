import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotSettings {
  alchemyApiKey: string;
  privateKey: string;
  profitWallet: string;
  contractAddress: string;
  minProfitUsd: number;      // minimum net profit in USD to execute
  maxSlippagePct: number;    // max allowed slippage %
  maxVolatilityPct: number;  // skip token if 1h price change > this %
  maxGasGwei: number;        // skip if gas price > this
  tradeAmountMatic: number;  // flash loan amount in MATIC
  autoExecute: boolean;
}

export interface ArbOpportunity {
  id: string;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  priceDiffPct: number;
  estimatedProfitUsd: number;
  gasCostUsd: number;
  netProfitUsd: number;
  slippagePct: number;
  volatilityPct: number;
  poolLiquidityUsd: number;
  confidence: number;        // 0-100
  safe: boolean;
  skipReason?: string;
  timestamp: number;
}

export interface TradeRecord {
  id: string;
  opportunity: ArbOpportunity;
  txHash?: string;
  status: "pending" | "success" | "failed" | "skipped";
  actualProfitUsd?: number;
  gasUsedUsd?: number;
  executedAt: number;
  errorMsg?: string;
}

export interface BotState {
  running: boolean;
  scanCount: number;
  totalProfitUsd: number;
  totalGasUsd: number;
  successTrades: number;
  failedTrades: number;
  skippedTrades: number;
  lastScanAt: number;
  gasGwei: number;
  maticPriceUsd: number;
  networkStatus: "connected" | "disconnected" | "error";
}

// ─── Default Settings ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: BotSettings = {
  alchemyApiKey: "",
  privateKey: "",
  profitWallet: "",
  contractAddress: "",
  minProfitUsd: 2.0,
  maxSlippagePct: 0.5,
  maxVolatilityPct: 5.0,
  maxGasGwei: 200,
  tradeAmountMatic: 1000,
  autoExecute: false,
};

export const DEFAULT_BOT_STATE: BotState = {
  running: false,
  scanCount: 0,
  totalProfitUsd: 0,
  totalGasUsd: 0,
  successTrades: 0,
  failedTrades: 0,
  skippedTrades: 0,
  lastScanAt: 0,
  gasGwei: 0,
  maticPriceUsd: 0,
  networkStatus: "disconnected",
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const KEYS = {
  SETTINGS: "bot:settings",
  TRADE_HISTORY: "bot:trade_history",
  BOT_STATE: "bot:state",
};

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<BotSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: BotSettings): Promise<void> {
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

export async function loadTradeHistory(): Promise<TradeRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.TRADE_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function appendTrade(trade: TradeRecord): Promise<void> {
  const history = await loadTradeHistory();
  const updated = [trade, ...history].slice(0, 500); // keep last 500
  await AsyncStorage.setItem(KEYS.TRADE_HISTORY, JSON.stringify(updated));
}

export async function clearTradeHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.TRADE_HISTORY);
}
