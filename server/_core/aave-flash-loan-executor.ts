import { ethers, Contract, AbiCoder, ZeroAddress } from 'ethers';

/**
 * Aave Flash Loan Executor
 * - Borrow capital without collateral
 * - Execute arbitrage trades
 * - Repay loan + fee
 * - Profit extraction
 */

// Aave V3 Pool contract ABI (minimal)
const AAVE_POOL_ABI = [
  'function flashLoan(address receiver, address[] calldata tokens, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external',
  'function flashLoanSimple(address receiver, address token, uint256 amount, bytes calldata params, uint16 referralCode) external',
  'function getReserveData(address asset) external view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 e_mode, uint128 unbacked, uint128 accruedToTreasury, uint128 totalAToken, uint128 totalStableDebt, uint128 totalVariableDebt) data)',
];

// Flash Loan Receiver ABI
const FLASH_LOAN_RECEIVER_ABI = [
  'function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bytes32)',
];

interface FlashLoanConfig {
  aavePoolAddress: string;
  receiverAddress: string;
  provider: ethers.Provider;
  signer: ethers.Signer;
}

interface FlashLoanRequest {
  token: string;
  amount: string;
  arbitrageData: {
    path: string[];
    amounts: string[];
    deadline: number;
  };
}

interface FlashLoanResult {
  success: boolean;
  profit: string;
  fee: string;
  txHash?: string;
  error?: string;
}

export class AaveFlashLoanExecutor {
  private aavePool: Contract | null = null;
  private receiver: Contract | null = null;
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private aavePoolAddress: string;
  private receiverAddress: string;

  // Aave V3 Polygon addresses
  private readonly AAVE_POOL_POLYGON = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
  private readonly AAVE_REFERRAL_CODE = 0;

  constructor(config: FlashLoanConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.aavePoolAddress = config.aavePoolAddress || this.AAVE_POOL_POLYGON;
    this.receiverAddress = config.receiverAddress;

    // Initialize contracts
    this.aavePool = new Contract(this.aavePoolAddress, AAVE_POOL_ABI, this.signer);
  }

  /**
   * Execute flash loan with arbitrage
   */
  async executeFlashLoan(request: FlashLoanRequest): Promise<FlashLoanResult> {
    try {
      console.log(`[FlashLoan] Executing flash loan for ${request.token}`);
      console.log(`[FlashLoan] Amount: ${ethers.formatEther(request.amount)} tokens`);

      // Validate inputs
      if (!ethers.isAddress(request.token)) {
        throw new Error('Invalid token address');
      }

      if (!ethers.isAddress(this.receiverAddress)) {
        throw new Error('Invalid receiver address');
      }

      // Get flash loan fee
      const fee = await this.calculateFlashLoanFee(request.token, request.amount);
      console.log(`[FlashLoan] Fee: ${ethers.formatEther(fee)} tokens`);

      // Encode parameters for receiver
      const params = AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256'],
        [request.arbitrageData.path, request.arbitrageData.amounts, request.arbitrageData.deadline]
      );

      // Execute flash loan
      const tx = await this.aavePool!.flashLoanSimple(
        this.receiverAddress,
        request.token,
        request.amount,
        params,
        this.AAVE_REFERRAL_CODE
      );

      console.log(`[FlashLoan] Transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt?.status === 0) {
        throw new Error('Transaction failed');
      }

      console.log(`[FlashLoan] Transaction confirmed in block ${receipt?.blockNumber}`);

      // Calculate profit (simplified - actual profit from arbitrage)
      const profit = ethers.parseEther('0'); // Will be updated with actual arbitrage profit

      return {
        success: true,
        profit: profit.toString(),
        fee: fee.toString(),
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('[FlashLoan] Execution failed:', error);
      return {
        success: false,
        profit: '0',
        fee: '0',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Calculate flash loan fee (0.05% on Aave V3)
   */
  async calculateFlashLoanFee(token: string, amount: string): Promise<bigint> {
    try {
      // Aave V3 flash loan fee is 0.05%
      const feePercentage = 5n; // 0.05% = 5 basis points
      const fee = (BigInt(amount) * feePercentage) / 10000n;
      return fee;
    } catch (error) {
      console.error('[FlashLoan] Fee calculation failed:', error);
      // Fallback to 0.05%
      return (BigInt(amount) * 5n) / 10000n;
    }
  }

  /**
   * Get reserve data for token
   */
  async getReserveData(token: string): Promise<any> {
    try {
      if (!this.aavePool) {
        throw new Error('Aave pool not initialized');
      }

      const data = await this.aavePool.getReserveData(token);
      return {
        isActive: data.configuration & 1n,
        isFrozen: (data.configuration >> 1n) & 1n,
        borrowingEnabled: (data.configuration >> 2n) & 1n,
        stableBorrowRateEnabled: (data.configuration >> 3n) & 1n,
        isFlashLoanEnabled: (data.configuration >> 15n) & 1n,
        liquidityIndex: data.liquidityIndex,
        currentLiquidityRate: data.currentLiquidityRate,
        variableBorrowIndex: data.variableBorrowIndex,
        currentVariableBorrowRate: data.currentVariableBorrowRate,
      };
    } catch (error) {
      console.error('[FlashLoan] Failed to get reserve data:', error);
      throw error;
    }
  }

  /**
   * Check if token supports flash loans
   */
  async isFlashLoanSupported(token: string): Promise<boolean> {
    try {
      const reserveData = await this.getReserveData(token);
      return reserveData.isFlashLoanEnabled === 1n;
    } catch (error) {
      console.error('[FlashLoan] Failed to check flash loan support:', error);
      return false;
    }
  }

  /**
   * Get maximum flash loan amount
   */
  async getMaxFlashLoanAmount(token: string): Promise<string> {
    try {
      if (!this.aavePool) {
        throw new Error('Aave pool not initialized');
      }

      // Get token balance of Aave pool (aToken)
      const tokenContract = new Contract(
        token,
        ['function balanceOf(address) view returns (uint256)'],
        this.provider
      );

      // Get aToken address from reserve data
      const reserveData = await this.aavePool.getReserveData(token);
      const aTokenAddress = reserveData.aTokenAddress;

      const balance = await tokenContract.balanceOf(aTokenAddress);
      return balance.toString();
    } catch (error) {
      console.error('[FlashLoan] Failed to get max flash loan amount:', error);
      return '0';
    }
  }

  /**
   * Validate flash loan parameters
   */
  async validateFlashLoan(request: FlashLoanRequest): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      // Check if token is valid
      if (!ethers.isAddress(request.token)) {
        errors.push('Invalid token address');
      }

      // Check if flash loans are supported
      const supported = await this.isFlashLoanSupported(request.token);
      if (!supported) {
        errors.push('Flash loans not supported for this token');
      }

      // Check if amount is available
      const maxAmount = await this.getMaxFlashLoanAmount(request.token);
      if (BigInt(request.amount) > BigInt(maxAmount)) {
        errors.push(`Requested amount exceeds available liquidity. Max: ${maxAmount}`);
      }

      // Check arbitrage path
      if (!request.arbitrageData.path || request.arbitrageData.path.length < 2) {
        errors.push('Invalid arbitrage path');
      }

      // Check deadline
      if (request.arbitrageData.deadline < Math.floor(Date.now() / 1000)) {
        errors.push('Deadline is in the past');
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      console.error('[FlashLoan] Validation failed:', error);
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation error'],
      };
    }
  }

  /**
   * Get flash loan status
   */
  async getStatus(): Promise<{
    poolAddress: string;
    receiverAddress: string;
    connected: boolean;
  }> {
    return {
      poolAddress: this.aavePoolAddress,
      receiverAddress: this.receiverAddress,
      connected: this.aavePool !== null,
    };
  }
}

export default AaveFlashLoanExecutor;
