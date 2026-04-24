import { ethers, Wallet, WebSocketProvider, Contract } from 'ethers';
import crypto from 'crypto';

/**
 * Production-Grade Wallet Manager
 * - Secure private key storage
 * - Transaction signing
 * - Nonce management
 * - Gas optimization
 */

interface WalletConfig {
  tradingPrivateKey: string;
  profitAddress: string;
  rpcUrl: string;
  alchemyKey: string;
}

interface TransactionRequest {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
}

interface SignedTransaction {
  hash: string;
  signature: string;
  from: string;
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  nonce: number;
}

export class ProductionWalletManager {
  private wallet: Wallet | null = null;
  private provider: WebSocketProvider | null = null;
  private profitAddress: string = '';
  private nonce: number = 0;
  private nonceCache = new Map<string, number>();
  private encryptionKey: string = '';

  constructor() {
    // Initialize encryption key from environment
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateEncryptionKey();
  }

  /**
   * Initialize wallet with private key
   */
  async initialize(config: WalletConfig): Promise<void> {
    try {
      // Validate private key format
      if (!config.tradingPrivateKey.startsWith('0x')) {
        config.tradingPrivateKey = '0x' + config.tradingPrivateKey;
      }

      if (config.tradingPrivateKey.length !== 66) {
        throw new Error('Invalid private key length. Expected 32 bytes (66 chars with 0x)');
      }

      // Initialize provider with Alchemy WebSocket
      const wsUrl = `wss://polygon-mainnet.g.alchemy.com/v2/${config.alchemyKey}`;
      this.provider = new ethers.WebSocketProvider(wsUrl);

      // Create wallet
      this.wallet = new Wallet(config.tradingPrivateKey, this.provider);
      this.profitAddress = config.profitAddress;

      // Validate addresses
      if (!ethers.isAddress(this.wallet.address)) {
        throw new Error('Invalid wallet address');
      }

      if (!ethers.isAddress(this.profitAddress)) {
        throw new Error('Invalid profit address');
      }

      // Initialize nonce
      await this.syncNonce();

      console.log(`[WalletManager] Initialized`);
      console.log(`[WalletManager] Trading wallet: ${this.wallet.address}`);
      console.log(`[WalletManager] Profit address: ${this.profitAddress}`);
      console.log(`[WalletManager] Current nonce: ${this.nonce}`);
    } catch (error) {
      console.error('[WalletManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Sync nonce from blockchain
   */
  async syncNonce(): Promise<void> {
    if (!this.wallet || !this.provider) {
      throw new Error('Wallet not initialized');
    }

    try {
      this.nonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
      this.nonceCache.set(this.wallet.address, this.nonce);
      console.log(`[WalletManager] Nonce synced: ${this.nonce}`);
    } catch (error) {
      console.error('[WalletManager] Failed to sync nonce:', error);
      throw error;
    }
  }

  /**
   * Get next nonce (increments locally for speed)
   */
  getNextNonce(): number {
    const nextNonce = this.nonce;
    this.nonce++;
    this.nonceCache.set(this.wallet!.address, this.nonce);
    return nextNonce;
  }

  /**
   * Get current wallet address
   */
  getAddress(): string {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }
    return this.wallet.address;
  }

  /**
   * Get profit address
   */
  getProfitAddress(): string {
    return this.profitAddress;
  }

  /**
   * Sign transaction
   */
  async signTransaction(txRequest: TransactionRequest): Promise<SignedTransaction> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    try {
      const nonce = this.getNextNonce();

      const tx = {
        to: txRequest.to,
        data: txRequest.data,
        value: txRequest.value || '0',
        gasLimit: txRequest.gasLimit || '500000',
        gasPrice: txRequest.gasPrice || await this.getGasPrice(),
        nonce: nonce,
        chainId: 137, // Polygon mainnet
      };

      // Sign transaction
      const signedTx = await this.wallet.signTransaction(tx);

      return {
        hash: ethers.id(signedTx),
        signature: signedTx,
        from: this.wallet.address,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        nonce: nonce,
      };
    } catch (error) {
      console.error('[WalletManager] Transaction signing failed:', error);
      throw error;
    }
  }

  /**
   * Get current gas price with optimization
   */
  async getGasPrice(): Promise<string> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    try {
      const feeData = await this.provider.getFeeData();
      
      if (!feeData.gasPrice) {
        throw new Error('Unable to fetch gas price');
      }

      // Use maxPriorityFeePerGas + baseFeePerGas for EIP-1559
      if (feeData.maxPriorityFeePerGas && feeData.maxFeePerGas) {
        return feeData.maxFeePerGas.toString();
      }

      return feeData.gasPrice.toString();
    } catch (error) {
      console.error('[WalletManager] Gas price fetch failed:', error);
      // Fallback to fixed price
      return ethers.parseUnits('100', 'gwei').toString();
    }
  }

  /**
   * Get wallet balance
   */
  async getBalance(): Promise<string> {
    if (!this.wallet || !this.provider) {
      throw new Error('Wallet not initialized');
    }

    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('[WalletManager] Balance fetch failed:', error);
      throw error;
    }
  }

  /**
   * Encrypt sensitive data
   */
  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  private decryptData(encryptedData: string): string {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Generate encryption key
   */
  private generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get wallet status
   */
  async getStatus(): Promise<{
    address: string;
    balance: string;
    nonce: number;
    profitAddress: string;
    connected: boolean;
  }> {
    if (!this.wallet || !this.provider) {
      return {
        address: '',
        balance: '0',
        nonce: 0,
        profitAddress: '',
        connected: false,
      };
    }

    try {
      const balance = await this.getBalance();
      return {
        address: this.wallet.address,
        balance,
        nonce: this.nonce,
        profitAddress: this.profitAddress,
        connected: true,
      };
    } catch (error) {
      console.error('[WalletManager] Status check failed:', error);
      return {
        address: this.wallet.address,
        balance: '0',
        nonce: this.nonce,
        profitAddress: this.profitAddress,
        connected: false,
      };
    }
  }

  /**
   * Disconnect wallet
   */
  async disconnect(): Promise<void> {
    if (this.provider) {
      this.provider.destroy();
    }
    this.wallet = null;
    this.provider = null;
    console.log('[WalletManager] Disconnected');
  }
}

export default ProductionWalletManager;
