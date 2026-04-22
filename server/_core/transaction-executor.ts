/**
 * Transaction Executor
 * Builds, signs, and submits transactions with gas optimization
 * 
 * Features:
 * - Dynamic gas price estimation
 * - Transaction building for swaps
 * - Nonce management
 * - Retry logic with exponential backoff
 */

import { ethers } from 'ethers';
import type { Provider, TransactionRequest } from 'ethers';
import { WalletManager } from './wallet-manager';

interface GasEstimate {
  gasPrice: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedGas: number;
  totalCost: string;
}

interface TransactionOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  gasMultiplier?: number; // 1.2 = 20% above estimate
}

interface ExecutionResult {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: number;
  error?: string;
  timestamp: number;
}

/**
 * Transaction executor with gas optimization
 */
export class TransactionExecutor {
  private walletManager: WalletManager;
  private provider: Provider;
  private chainId: number;
  private gasMultiplier = 1.15; // 15% buffer
  private maxRetries = 3;
  private retryDelayMs = 1000;

  constructor(walletManager: WalletManager, chainId: number) {
    this.walletManager = walletManager;
    this.provider = walletManager.getProvider();
    this.chainId = chainId;
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(tx: TransactionRequest): Promise<GasEstimate> {
    try {
      // Get current gas prices
      const feeData = await this.provider.getFeeData();
      if (!feeData.gasPrice && !feeData.maxFeePerGas) {
        throw new Error('Unable to fetch gas prices');
      }

      // Estimate gas
      const gasEstimate = await this.provider.estimateGas(tx);

      // Calculate costs
      const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice!;
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei');

      const adjustedGas = Math.ceil(Number(gasEstimate) * this.gasMultiplier);
      const totalCost = ethers.formatEther((maxFeePerGas as bigint) * BigInt(adjustedGas));

      return {
        gasPrice: ethers.formatUnits(feeData.gasPrice || maxFeePerGas, 'gwei'),
        maxFeePerGas: ethers.formatUnits(maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.formatUnits(maxPriorityFeePerGas, 'gwei'),
        estimatedGas: adjustedGas,
        totalCost,
      };
    } catch (error: any) {
      console.error('[TransactionExecutor] Gas estimation failed:', error.message);
      throw error;
    }
  }

  /**
   * Build swap transaction
   */
  async buildSwapTx(
    routerAddress: string,
    amountIn: string,
    amountOutMin: string,
    path: string[],
    deadline: number
  ): Promise<TransactionRequest> {
    const wallet = this.walletManager.getWallet();
    const nonce = await this.walletManager.getNonce(wallet.address);

    // Uniswap V2 Router swap function selector
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
    ]);

    const data = iface.encodeFunctionData('swapExactTokensForTokens', [
      ethers.parseUnits(amountIn, 18),
      ethers.parseUnits(amountOutMin, 18),
      path,
      wallet.address,
      deadline,
    ]);

    const feeData = await this.provider.getFeeData();
    const gasEstimate = await this.provider.estimateGas({
      to: routerAddress,
      data,
      from: wallet.address,
    });

    return {
      to: routerAddress,
      from: wallet.address,
      data,
      nonce,
      gasLimit: Math.ceil(Number(gasEstimate) * this.gasMultiplier),
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei'),
      chainId: this.chainId,
    };
  }

  /**
   * Build flash loan transaction
   */
  async buildFlashLoanTx(
    lenderAddress: string,
    tokens: string[],
    amounts: string[],
    callbackData: string
  ): Promise<TransactionRequest> {
    const wallet = this.walletManager.getWallet();
    const nonce = await this.walletManager.getNonce(wallet.address);

    // Aave flash loan function selector
    const iface = new ethers.Interface([
      'function flashLoan(address receiver, address[] tokens, uint256[] amounts, bytes calldata params)',
    ]);

    const data = iface.encodeFunctionData('flashLoan', [
      wallet.address,
      tokens,
      amounts.map((a) => ethers.parseUnits(a, 18)),
      callbackData,
    ]);

    const feeData = await this.provider.getFeeData();

    return {
      to: lenderAddress,
      from: wallet.address,
      data,
      nonce,
      gasLimit: 500000, // Flash loans need more gas
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei'),
      chainId: this.chainId,
    };
  }

  /**
   * Execute transaction with retry logic
   */
  async executeTransaction(
    tx: TransactionRequest,
    options: TransactionOptions = {}
  ): Promise<ExecutionResult> {
    const maxRetries = options.maxRetries || this.maxRetries;
    const retryDelayMs = options.retryDelayMs || this.retryDelayMs;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[TransactionExecutor] Executing transaction (attempt ${attempt + 1}/${maxRetries})`);

        // Sign transaction
        const signedTx = await this.walletManager.signTransaction(tx);

        // Submit to mempool
        const txResponse = await this.provider.broadcastTransaction(signedTx);
        console.log(`[TransactionExecutor] Transaction submitted: ${txResponse.hash}`);

        // Wait for confirmation
        const receipt = await txResponse.wait(1);

        if (!receipt) {
          throw new Error('Transaction failed to confirm');
        }

        console.log(`[TransactionExecutor] Transaction confirmed in block ${receipt.blockNumber}`);

        // Increment nonce for next transaction
        this.walletManager.incrementNonce(tx.from as string);

        return {
          success: true,
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: Number(receipt.gasUsed),
          timestamp: Date.now(),
        };
      } catch (error: any) {
        console.error(`[TransactionExecutor] Attempt ${attempt + 1} failed:`, error.message);

        if (attempt < maxRetries - 1) {
          const delay = retryDelayMs * Math.pow(2, attempt); // Exponential backoff
          console.log(`[TransactionExecutor] Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          return {
            success: false,
            error: error.message,
            timestamp: Date.now(),
          };
        }
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      timestamp: Date.now(),
    };
  }

  /**
   * Simulate transaction (dry run)
   */
  async simulateTransaction(tx: TransactionRequest): Promise<{ success: boolean; error?: string }> {
    try {
      await this.provider.call(tx);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    blockNumber?: number;
    gasUsed?: number;
  }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return { status: 'pending' };
      }

      return {
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: Number(receipt.gasUsed),
      };
    } catch (error: any) {
      console.error('[TransactionExecutor] Failed to get transaction status:', error.message);
      throw error;
    }
  }

  /**
   * Set gas multiplier
   */
  setGasMultiplier(multiplier: number): void {
    if (multiplier < 1 || multiplier > 2) {
      throw new Error('Gas multiplier must be between 1 and 2');
    }
    this.gasMultiplier = multiplier;
  }

  /**
   * Get current gas prices
   */
  async getGasPrices(): Promise<{
    standard: string;
    fast: string;
    instant: string;
  }> {
    try {
      const feeData = await this.provider.getFeeData();

      const basePrice = feeData.gasPrice || feeData.maxFeePerGas || BigInt(0);
      const standard = ethers.formatUnits(basePrice, 'gwei');
      const fast = ethers.formatUnits((basePrice as bigint) * BigInt(12) / BigInt(10), 'gwei');
      const instant = ethers.formatUnits((basePrice as bigint) * BigInt(15) / BigInt(10), 'gwei');

      return { standard, fast, instant };
    } catch (error: any) {
      console.error('[TransactionExecutor] Failed to get gas prices:', error.message);
      throw error;
    }
  }
}
