/**
 * Keeper Service Integration
 * 
 * Bridges the mobile app UI with the Keeper trading engine.
 * Handles credential management, bot lifecycle, and real-time updates.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventEmitter } from 'events';

export interface BotSettings {
  privateKey: string;
  alchemyKey: string;
  profitWallet: string;
  initialCapital: number;
  minProfitUSD: number;
  maxSlippagePercent: number;
  maxGasGwei: number;
  network: 'polygon' | 'mumbai';
}

export interface BotStatus {
  running: boolean;
  connected: boolean;
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalGasCost: number;
  lastTradeTime: number | null;
  poolsTracked: number;
  currentGasPrice: number;
}

export interface Trade {
  id: string;
  pair: string;
  amount: number;
  profit: number;
  gasUsed: number;
  timestamp: number;
  txHash: string;
  status: 'success' | 'failed' | 'pending';
}

class KeeperService extends EventEmitter {
  private botRunning: boolean = false;
  private botSettings: BotSettings | null = null;
  private botStatus: BotStatus = {
    running: false,
    connected: false,
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
    totalGasCost: 0,
    lastTradeTime: null,
    poolsTracked: 0,
    currentGasPrice: 0,
  };
  private trades: Trade[] = [];
  private statusUpdateInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Load settings from storage
   */
  async loadSettings(): Promise<BotSettings | null> {
    try {
      const stored = await AsyncStorage.getItem('botSettings');
      if (stored) {
        this.botSettings = JSON.parse(stored);
        return this.botSettings;
      }
    } catch (error) {
      console.error('[Keeper] Failed to load settings:', error);
    }
    return null;
  }

  /**
   * Save settings to storage
   */
  async saveSettings(settings: BotSettings): Promise<void> {
    try {
      await AsyncStorage.setItem('botSettings', JSON.stringify(settings));
      this.botSettings = settings;
      this.emit('settings-updated', settings);
    } catch (error) {
      console.error('[Keeper] Failed to save settings:', error);
      throw error;
    }
  }

  /**
   * Validate settings before starting bot
   */
  validateSettings(settings: BotSettings): { valid: boolean; error?: string } {
    if (!settings.privateKey.startsWith('0x') || settings.privateKey.length !== 66) {
      return { valid: false, error: 'Invalid private key format' };
    }

    if (!settings.alchemyKey) {
      return { valid: false, error: 'Alchemy key is required' };
    }

    if (!settings.profitWallet.startsWith('0x') || settings.profitWallet.length !== 42) {
      return { valid: false, error: 'Invalid profit wallet address' };
    }

    if (settings.initialCapital < 100) {
      return { valid: false, error: 'Minimum capital is $100' };
    }

    return { valid: true };
  }

  /**
   * Start the bot
   */
  async startBot(): Promise<void> {
    try {
      if (this.botRunning) {
        throw new Error('Bot is already running');
      }

      const settings = await this.loadSettings();
      if (!settings) {
        throw new Error('Settings not configured');
      }

      // Validate settings
      const validation = this.validateSettings(settings);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      console.log('[Keeper] Starting bot with settings:', {
        network: settings.network,
        capital: settings.initialCapital,
      });

      // Update status
      this.botRunning = true;
      this.botStatus.running = true;
      this.botStatus.connected = true;

      // In production, this would connect to the actual Keeper service
      // For now, we simulate trades for demonstration
      this.startSimulation();

      this.emit('bot-started');
      await this.saveBotStatus();
    } catch (error) {
      console.error('[Keeper] Failed to start bot:', error);
      this.botRunning = false;
      this.botStatus.running = false;
      this.emit('bot-error', error);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stopBot(): Promise<void> {
    try {
      console.log('[Keeper] Stopping bot');

      this.botRunning = false;
      this.botStatus.running = false;

      if (this.statusUpdateInterval) {
        clearInterval(this.statusUpdateInterval);
        this.statusUpdateInterval = null;
      }

      this.emit('bot-stopped');
      await this.saveBotStatus();
    } catch (error) {
      console.error('[Keeper] Failed to stop bot:', error);
      this.emit('bot-error', error);
      throw error;
    }
  }

  /**
   * Simulate trades for demonstration
   */
  private startSimulation() {
    // Update gas price every 30 seconds
    this.statusUpdateInterval = setInterval(() => {
      this.botStatus.currentGasPrice = Math.floor(Math.random() * 100) + 20;

      // Simulate occasional trades
      if (Math.random() > 0.7) {
        this.simulateTrade();
      }

      this.emit('status-updated', this.botStatus);
    }, 30000);

    // Initial update
    this.emit('status-updated', this.botStatus);
  }

  /**
   * Simulate a trade
   */
  private simulateTrade() {
    const profit = (Math.random() * 50 - 10); // -$10 to +$50
    const gasUsed = Math.random() * 5 + 1; // 1-6 MATIC

    const trade: Trade = {
      id: `trade_${Date.now()}`,
      pair: ['USDC/WMATIC', 'USDC/USDT', 'WMATIC/WETH'][Math.floor(Math.random() * 3)],
      amount: 1000,
      profit,
      gasUsed,
      timestamp: Date.now(),
      txHash: `0x${Math.random().toString(16).slice(2)}`,
      status: profit > 0 ? 'success' : 'failed',
    };

    this.trades.push(trade);
    this.botStatus.totalTrades++;

    if (trade.status === 'success') {
      this.botStatus.successfulTrades++;
      this.botStatus.totalProfit += profit;
      this.botStatus.lastTradeTime = Date.now();
    }

    this.botStatus.totalGasCost += gasUsed;

    this.emit('trade-executed', trade);
  }

  /**
   * Get current bot status
   */
  getStatus(): BotStatus {
    return { ...this.botStatus };
  }

  /**
   * Get trade history
   */
  getTrades(limit: number = 20): Trade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Get bot settings
   */
  getSettings(): BotSettings | null {
    return this.botSettings ? { ...this.botSettings } : null;
  }

  /**
   * Save bot status to storage
   */
  private async saveBotStatus(): Promise<void> {
    try {
      await AsyncStorage.setItem('botStatus', JSON.stringify(this.botStatus));
      await AsyncStorage.setItem('botTrades', JSON.stringify(this.trades));
    } catch (error) {
      console.error('[Keeper] Failed to save status:', error);
    }
  }

  /**
   * Load bot status from storage
   */
  async loadBotStatus(): Promise<void> {
    try {
      const status = await AsyncStorage.getItem('botStatus');
      const trades = await AsyncStorage.getItem('botTrades');

      if (status) {
        this.botStatus = JSON.parse(status);
      }

      if (trades) {
        this.trades = JSON.parse(trades);
      }
    } catch (error) {
      console.error('[Keeper] Failed to load status:', error);
    }
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem('botSettings');
      await AsyncStorage.removeItem('botStatus');
      await AsyncStorage.removeItem('botTrades');

      this.botSettings = null;
      this.botRunning = false;
      this.botStatus = {
        running: false,
        connected: false,
        totalTrades: 0,
        successfulTrades: 0,
        totalProfit: 0,
        totalGasCost: 0,
        lastTradeTime: null,
        poolsTracked: 0,
        currentGasPrice: 0,
      };
      this.trades = [];

      this.emit('data-cleared');
    } catch (error) {
      console.error('[Keeper] Failed to clear data:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const keeperService = new KeeperService();
