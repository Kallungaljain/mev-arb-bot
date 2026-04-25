/**
 * Balancer V2 Flash Loan Executor
 * Replaces Aave with Balancer for flash loans
 * Balancer V2 offers:
 * - No fee (0% vs Aave's 0.09%)
 * - Higher borrowing limits
 * - Better capital efficiency
 */

import * as ethers from 'ethers';

export interface BalancerFlashLoanConfig {
  balancerVaultAddress: string;
  receiverAddress: string;
  provider: ethers.Provider;
  signer: ethers.Signer;
}

export interface BalancerFlashLoanRequest {
  tokens: string[];
  amounts: string[];
  arbitrageData: {
    path: string[];
    amounts: string[];
    deadline: number;
  };
}

export interface BalancerFlashLoanResult {
  success: boolean;
  profit: string;
  fee: string; // Always 0 for Balancer
  txHash?: string;
  error?: string;
}

/**
 * Balancer V2 Constants
 */
const BALANCER_VAULT_POLYGON = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// Balancer Vault ABI (relevant functions)
const BALANCER_VAULT_ABI = [
  {
    name: 'flashLoan',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [],
  },
];

/**
 * Balancer V2 Flash Loan Executor
 * 
 * Flow:
 * 1. Call vault.flashLoan(receiver, tokens, amounts, userData)
 * 2. Vault transfers tokens to receiver
 * 3. Receiver executes arbitrage trades
 * 4. Receiver repays tokens to vault (NO FEE)
 * 5. Vault verifies repayment
 * 6. Profit transferred to user
 */
export class BalancerFlashLoanExecutor {
  private vaultAddress: string;
  private receiverAddress: string;
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private vaultInterface: ethers.Interface;

  constructor(config: BalancerFlashLoanConfig) {
    this.vaultAddress = ethers.getAddress(config.balancerVaultAddress);
    this.receiverAddress = ethers.getAddress(config.receiverAddress);
    this.provider = config.provider;
    this.signer = config.signer;
    this.vaultInterface = new ethers.Interface(BALANCER_VAULT_ABI);

    console.log('[BalancerFlashLoanExecutor] Initialized');
    console.log('Vault:', this.vaultAddress);
    console.log('Receiver:', this.receiverAddress);
  }

  /**
   * Execute flash loan
   */
  async executeFlashLoan(
    request: BalancerFlashLoanRequest
  ): Promise<BalancerFlashLoanResult> {
    try {
      console.log('[BalancerFlashLoanExecutor] Executing flash loan');
      console.log('Tokens:', request.tokens);
      console.log('Amounts:', request.amounts);

      // Validate input
      if (request.tokens.length !== request.amounts.length) {
        throw new Error('Tokens and amounts length mismatch');
      }

      if (request.tokens.length === 0) {
        throw new Error('No tokens specified');
      }

      // Encode arbitrage data
      const encodedArbitrageData = this.encodeArbitrageData(request.arbitrageData);

      // Build flash loan call
      const calldata = this.vaultInterface.encodeFunctionData('flashLoan', [
        this.receiverAddress,
        request.tokens,
        request.amounts,
        encodedArbitrageData,
      ]);

      // Create transaction
      const tx = {
        to: this.vaultAddress,
        data: calldata,
        value: '0',
      };

      console.log('[BalancerFlashLoanExecutor] Submitting flash loan transaction');

      // Estimate gas
      const gasEstimate = await this.provider.estimateGas(tx);
      console.log('Gas estimate:', gasEstimate.toString());

      // Get gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('50', 'gwei');

      // Build and sign transaction
      const nonce = await this.signer.getNonce();
      const signedTx = await this.signer.signTransaction({
        to: this.vaultAddress,
        data: calldata,
        value: '0',
        gasLimit: gasEstimate * 120n / 100n, // 20% buffer
        gasPrice: gasPrice,
        nonce: nonce,
      });

      // Submit transaction
      const txResponse = await this.provider.broadcastTransaction(signedTx);
      console.log('Transaction submitted:', txResponse.hash);

      // Wait for confirmation
      const receipt = await txResponse.wait(1);

      if (!receipt) {
        throw new Error('Transaction failed');
      }

      console.log('Transaction confirmed:', receipt.hash);

      // Extract profit from logs
      const profit = await this.extractProfit(receipt);

      return {
        success: true,
        profit: profit.toString(),
        fee: '0', // Balancer has 0% fee
        txHash: receipt.hash,
      };
    } catch (error: any) {
      console.error('[BalancerFlashLoanExecutor] Error:', error.message);
      return {
        success: false,
        profit: '0',
        fee: '0',
        error: error.message,
      };
    }
  }

  /**
   * Encode arbitrage data for receiver contract
   */
  private encodeArbitrageData(data: {
    path: string[];
    amounts: string[];
    deadline: number;
  }): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(
      ['address[]', 'uint256[]', 'uint256'],
      [data.path, data.amounts, data.deadline]
    );
  }

  /**
   * Extract profit from transaction receipt
   */
  private async extractProfit(receipt: ethers.TransactionReceipt): Promise<bigint> {
    // In a real implementation, parse logs to extract profit
    // For now, return 0 (would be calculated from transfer events)
    return 0n;
  }

  /**
   * Calculate fee (always 0 for Balancer)
   */
  calculateFee(amount: bigint): bigint {
    return 0n; // Balancer V2 has 0% fee
  }

  /**
   * Validate repayment
   */
  async validateRepayment(tokens: string[], amounts: bigint[]): Promise<boolean> {
    // Check that receiver contract has sufficient balance
    for (let i = 0; i < tokens.length; i++) {
      const balance = await this.getTokenBalance(tokens[i], this.receiverAddress);
      if (balance < amounts[i]) {
        console.error(
          `Insufficient balance for token ${tokens[i]}: ${balance} < ${amounts[i]}`
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Get token balance
   */
  private async getTokenBalance(tokenAddress: string, account: string): Promise<bigint> {
    const erc20ABI = ['function balanceOf(address account) external view returns (uint256)'];
    const contract = new ethers.Contract(tokenAddress, erc20ABI, this.provider);
    return await contract.balanceOf(account);
  }

  /**
   * Get Balancer vault address for network
   */
  static getVaultAddress(chainId: number): string {
    const vaults: { [key: number]: string } = {
      1: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Ethereum
      137: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Polygon
      42161: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Arbitrum
    };

    const vault = vaults[chainId];
    if (!vault) {
      throw new Error(`Balancer Vault not found for chain ${chainId}`);
    }
    return vault;
  }
}

/**
 * Balancer Flash Loan Receiver Contract Interface
 * This contract receives the flash loan and must implement:
 * 
 * function receiveFlashLoan(
 *   IERC20[] memory tokens,
 *   uint256[] memory amounts,
 *   uint256[] memory feeAmounts,
 *   bytes memory userData
 * ) external
 * 
 * The receiver contract must:
 * 1. Execute arbitrage trades
 * 2. Repay tokens to vault
 * 3. Transfer profit to user
 */
export const BALANCER_FLASH_LOAN_RECEIVER_ABI = [
  {
    name: 'receiveFlashLoan',
    type: 'function',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'feeAmounts', type: 'uint256[]' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [],
  },
];

/**
 * Example Balancer Flash Loan Receiver Contract (Solidity)
 * 
 * pragma solidity ^0.8.0;
 * 
 * import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
 * import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
 * import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
 * 
 * contract BalancerFlashLoanReceiver is IFlashLoanRecipient {
 *   IVault private vault;
 *   address private owner;
 * 
 *   constructor(address _vault) {
 *     vault = IVault(_vault);
 *     owner = msg.sender;
 *   }
 * 
 *   function receiveFlashLoan(
 *     IERC20[] memory tokens,
 *     uint256[] memory amounts,
 *     uint256[] memory feeAmounts,
 *     bytes memory userData
 *   ) external override {
 *     require(msg.sender == address(vault), "Unauthorized");
 * 
 *     // Decode arbitrage data
 *     (address[] memory path, uint256[] memory swapAmounts, uint256 deadline) = 
 *       abi.decode(userData, (address[], uint256[], uint256));
 * 
 *     // Execute arbitrage trades
 *     // 1. Swap token[0] -> token[1]
 *     // 2. Swap token[1] -> token[2]
 *     // 3. Swap token[2] -> token[0]
 * 
 *     // Calculate profit
 *     uint256 finalAmount = tokens[0].balanceOf(address(this));
 *     uint256 profit = finalAmount - amounts[0];
 * 
 *     // Repay flash loan (NO FEE for Balancer)
 *     tokens[0].approve(address(vault), amounts[0]);
 * 
 *     // Transfer profit to owner
 *     tokens[0].transfer(owner, profit);
 *   }
 * }
 */

/**
 * Usage Example
 */
export async function exampleBalancerFlashLoan() {
  const provider = new ethers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  );

  const signer = new ethers.Wallet(process.env.TRADING_PRIVATE_KEY!, provider);

  const executor = new BalancerFlashLoanExecutor({
    balancerVaultAddress: BALANCER_VAULT_POLYGON,
    receiverAddress: process.env.RECEIVER_CONTRACT_ADDRESS!,
    provider,
    signer,
  });

  // Execute flash loan
  const result = await executor.executeFlashLoan({
    tokens: [
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
    ],
    amounts: [
      ethers.parseUnits('1000000', 6).toString(), // 1M USDC
    ],
    arbitrageData: {
      path: [
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
        '0x8f3Cf7ad23Cd3CaDbD9735AFF958023D60d76546', // DAI
        '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
      ],
      amounts: [
        ethers.parseUnits('1000000', 6).toString(),
        ethers.parseUnits('1005000', 18).toString(),
        ethers.parseUnits('1007010', 6).toString(),
        ethers.parseUnits('1005009', 6).toString(),
      ],
      deadline: Math.floor(Date.now() / 1000) + 300,
    },
  });

  console.log('Flash loan result:', result);
  console.log('Profit:', ethers.formatUnits(result.profit, 6), 'USDC');
  console.log('Fee:', ethers.formatUnits(result.fee, 6), 'USDC');
}
