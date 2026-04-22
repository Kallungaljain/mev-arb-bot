/**
 * Secure Wallet Manager
 * Handles private key injection, account management, and signing
 * 
 * Key Features:
 * - Secure key storage (environment variables)
 * - Multi-account support (trading + profit withdrawal)
 * - Nonce management
 * - Transaction signing
 */

import { ethers } from 'ethers';
import type { Wallet, Provider } from 'ethers';

interface WalletConfig {
  tradingPrivateKey?: string; // Injected from app/env
  profitWithdrawalAddress?: string; // Injected from app
  rpcUrl: string;
  chainId: number;
}

interface AccountState {
  address: string;
  balance: string;
  nonce: number;
  lastUpdated: number;
}

/**
 * Secure wallet manager for trading operations
 */
export class WalletManager {
  private tradingWallet: Wallet | null = null;
  private profitAddress: string | null = null;
  private provider: Provider;
  private chainId: number;
  private accountStates = new Map<string, AccountState>();
  private nonceCache = new Map<string, number>();
  private lastNonceUpdate = 0;

  constructor(config: WalletConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.chainId = config.chainId;
    this.profitAddress = config.profitWithdrawalAddress || null;

    // Initialize trading wallet if key provided
    if (config.tradingPrivateKey) {
      this.setTradingKey(config.tradingPrivateKey);
    }
  }

  /**
   * Set trading private key (called from app with user input)
   */
  setTradingKey(privateKey: string): void {
    try {
      // Validate key format
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }

      if (privateKey.length !== 66) {
        throw new Error('Invalid private key length');
      }

      this.tradingWallet = new ethers.Wallet(privateKey, this.provider);
      console.log(`[WalletManager] Trading wallet set: ${this.tradingWallet.address}`);
    } catch (error: any) {
      console.error('[WalletManager] Invalid private key:', error.message);
      throw new Error('Invalid private key format');
    }
  }

  /**
   * Set profit withdrawal address
   */
  setProfitAddress(address: string): void {
    if (!ethers.isAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }
    this.profitAddress = address;
    console.log(`[WalletManager] Profit address set: ${address}`);
  }

  /**
   * Get trading wallet address
   */
  getTradingAddress(): string {
    if (!this.tradingWallet) {
      throw new Error('Trading wallet not initialized');
    }
    return this.tradingWallet.address;
  }

  /**
   * Get profit withdrawal address
   */
  getProfitAddress(): string {
    if (!this.profitAddress) {
      throw new Error('Profit address not set');
    }
    return this.profitAddress;
  }

  /**
   * Check if wallet is ready
   */
  isReady(): boolean {
    return this.tradingWallet !== null && this.profitAddress !== null;
  }

  /**
   * Get current nonce for address
   */
  async getNonce(address: string): Promise<number> {
    try {
      // Use cache if recent
      const cached = this.nonceCache.get(address);
      if (cached && Date.now() - this.lastNonceUpdate < 5000) {
        return cached;
      }

      // Fetch from RPC
      const nonce = await this.provider.getTransactionCount(address, 'latest');
      this.nonceCache.set(address, nonce);
      this.lastNonceUpdate = Date.now();

      return nonce;
    } catch (error: any) {
      console.error('[WalletManager] Failed to get nonce:', error.message);
      throw error;
    }
  }

  /**
   * Increment nonce locally (for pending transactions)
   */
  incrementNonce(address: string): void {
    const current = this.nonceCache.get(address) || 0;
    this.nonceCache.set(address, current + 1);
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error: any) {
      console.error('[WalletManager] Failed to get balance:', error.message);
      throw error;
    }
  }

  /**
   * Get account state (balance + nonce)
   */
  async getAccountState(address: string): Promise<AccountState> {
    try {
      const balance = await this.provider.getBalance(address);
      const nonce = await this.getNonce(address);

      const state: AccountState = {
        address,
        balance: ethers.formatEther(balance),
        nonce,
        lastUpdated: Date.now(),
      };

      this.accountStates.set(address, state);
      return state;
    } catch (error: any) {
      console.error('[WalletManager] Failed to get account state:', error.message);
      throw error;
    }
  }

  /**
   * Sign transaction
   */
  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    if (!this.tradingWallet) {
      throw new Error('Trading wallet not initialized');
    }

    try {
      const signed = await this.tradingWallet.signTransaction(tx);
      return signed;
    } catch (error: any) {
      console.error('[WalletManager] Failed to sign transaction:', error.message);
      throw error;
    }
  }

  /**
   * Sign message
   */
  async signMessage(message: string): Promise<string> {
    if (!this.tradingWallet) {
      throw new Error('Trading wallet not initialized');
    }

    try {
      const signature = await this.tradingWallet.signMessage(message);
      return signature;
    } catch (error: any) {
      console.error('[WalletManager] Failed to sign message:', error.message);
      throw error;
    }
  }

  /**
   * Get provider
   */
  getProvider(): Provider {
    return this.provider;
  }

  /**
   * Get wallet (for direct operations)
   */
  getWallet(): Wallet {
    if (!this.tradingWallet) {
      throw new Error('Trading wallet not initialized');
    }
    return this.tradingWallet;
  }

  /**
   * Clear sensitive data
   */
  clear(): void {
    this.tradingWallet = null;
    this.profitAddress = null;
    this.nonceCache.clear();
    console.log('[WalletManager] Wallet cleared');
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      tradingWalletSet: this.tradingWallet !== null,
      tradingAddress: this.tradingWallet?.address || null,
      profitAddressSet: this.profitAddress !== null,
      profitAddress: this.profitAddress,
      isReady: this.isReady(),
    };
  }
}

/**
 * Multi-wallet manager for complex scenarios
 */
export class MultiWalletManager {
  private wallets = new Map<string, WalletManager>();
  private defaultWallet: string | null = null;

  /**
   * Add wallet
   */
  addWallet(name: string, config: WalletConfig): void {
    const manager = new WalletManager(config);
    this.wallets.set(name, manager);

    if (!this.defaultWallet) {
      this.defaultWallet = name;
    }
  }

  /**
   * Get wallet manager
   */
  getWallet(name?: string): WalletManager {
    const walletName = name || this.defaultWallet;
    if (!walletName) {
      throw new Error('No wallet available');
    }

    const wallet = this.wallets.get(walletName);
    if (!wallet) {
      throw new Error(`Wallet not found: ${walletName}`);
    }

    return wallet;
  }

  /**
   * Get default wallet
   */
  getDefaultWallet(): WalletManager {
    return this.getWallet();
  }

  /**
   * List all wallets
   */
  listWallets(): string[] {
    return Array.from(this.wallets.keys());
  }

  /**
   * Remove wallet
   */
  removeWallet(name: string): void {
    this.wallets.delete(name);
    if (this.defaultWallet === name) {
      this.defaultWallet = this.wallets.keys().next().value || null;
    }
  }

  /**
   * Clear all wallets
   */
  clearAll(): void {
    for (const wallet of this.wallets.values()) {
      wallet.clear();
    }
    this.wallets.clear();
    this.defaultWallet = null;
  }
}
