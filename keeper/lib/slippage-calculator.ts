/**
 * Slippage Calculator
 * 
 * Calculates actual swap output using Uniswap V2 x*y=k formula.
 * Accounts for DEX fees and simulates full arbitrage flow.
 */

interface SwapSimulation {
  amountOut: bigint;
  slippagePercent: number;
  priceImpact: number;
}

interface ArbitrageSimulation {
  profitAmount: bigint;
  profitPercent: number;
  slippageLoss: bigint;
  totalFees: bigint;
  intermediateAmount: bigint;
}

export class SlippageCalculator {
  /**
   * Calculate output amount for exact-input swap using x*y=k formula
   * 
   * Formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
   * - 997/1000 accounts for 0.3% Uniswap V2 fee
   * - Works for both token0→token1 and token1→token0
   */
  calculateSwapOutput(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feeBps: number = 30 // 30 basis points = 0.3%
  ): SwapSimulation {
    if (amountIn <= BigInt(0) || reserveIn <= BigInt(0) || reserveOut <= BigInt(0)) {
      return {
        amountOut: BigInt(0),
        slippagePercent: 0,
        priceImpact: 0,
      };
    }

    // Calculate with fee: (amountIn * (10000 - fee)) / 10000
    const feeMultiplier = BigInt(10000 - feeBps);
    const amountInWithFee = (amountIn * feeMultiplier) / BigInt(10000);

    // Apply x*y=k formula
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * BigInt(10000) + amountInWithFee * BigInt(10000 - feeBps);

    const amountOut = numerator / denominator;

    // Calculate slippage
    // Perfect price: amountIn / reserveIn * reserveOut
    const perfectOutput = (amountIn * reserveOut) / reserveIn;
    const slippageAmount = perfectOutput - amountOut;
    const slippagePercent = Number(slippageAmount * BigInt(10000) / perfectOutput) / 100;

    // Calculate price impact
    // Price impact = (amountIn / (reserveIn + amountIn)) * 100
    const priceImpact = Number((amountIn * BigInt(10000)) / (reserveIn + amountIn)) / 100;

    return {
      amountOut,
      slippagePercent,
      priceImpact,
    };
  }

  /**
   * Calculate output for exact-output swap (reverse calculation)
   */
  calculateSwapInput(
    amountOut: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feeBps: number = 30
  ): bigint {
    if (amountOut <= BigInt(0) || amountOut >= reserveOut) {
      return BigInt(0);
    }

    const feeMultiplier = BigInt(10000 - feeBps);
    const numerator = reserveIn * amountOut * BigInt(10000);
    const denominator = (reserveOut - amountOut) * feeMultiplier;

    return numerator / denominator + BigInt(1); // +1 for rounding
  }

  /**
   * Simulate complete arbitrage flow with real slippage
   * 
   * Flow:
   * 1. Borrow amount from AAVE
   * 2. Swap on DEX A: token0 → token1
   * 3. Swap on DEX B: token1 → token0
   * 4. Repay AAVE (principal + fee)
   * 5. Keep profit
   */
  simulateArbitrage(
    borrowAmount: bigint,
    buyPoolReserves: { reserve0: bigint; reserve1: bigint },
    sellPoolReserves: { reserve0: bigint; reserve1: bigint },
    aaveFeePercent: number = 0.05
  ): ArbitrageSimulation {
    // Step 1: Swap on buy DEX (token0 → token1)
    const buySwap = this.calculateSwapOutput(
      borrowAmount,
      buyPoolReserves.reserve0,
      buyPoolReserves.reserve1,
      30 // Uniswap V2 fee
    );

    const intermediateAmount = buySwap.amountOut;

    // Step 2: Swap on sell DEX (token1 → token0)
    const sellSwap = this.calculateSwapOutput(
      intermediateAmount,
      sellPoolReserves.reserve1,
      sellPoolReserves.reserve0,
      30 // Uniswap V2 fee
    );

    const finalAmount = sellSwap.amountOut;

    // Step 3: Calculate AAVE fee
    const aaveFee = (borrowAmount * BigInt(Math.floor(aaveFeePercent * 10000))) / BigInt(1000000);
    const totalRepay = borrowAmount + aaveFee;

    // Step 4: Calculate profit
    const profit = finalAmount > totalRepay ? finalAmount - totalRepay : BigInt(0);

    // Step 5: Calculate losses
    const slippageLoss = borrowAmount - intermediateAmount + intermediateAmount - finalAmount;
    const totalFees = aaveFee + (borrowAmount - intermediateAmount) + (intermediateAmount - finalAmount);

    // Calculate profit percentage
    const profitPercent = profit > BigInt(0)
      ? Number((profit * BigInt(10000)) / borrowAmount) / 100
      : 0;

    return {
      profitAmount: profit,
      profitPercent,
      slippageLoss,
      totalFees,
      intermediateAmount,
    };
  }

  /**
   * Simulate arbitrage with multiple intermediate tokens
   * Useful for 3-hop or 4-hop arbitrage
   */
  simulateMultiHopArbitrage(
    borrowAmount: bigint,
    poolReserves: Array<{ reserve0: bigint; reserve1: bigint }>,
    aaveFeePercent: number = 0.05
  ): ArbitrageSimulation {
    let currentAmount = borrowAmount;
    let totalSlippage = BigInt(0);
    let totalFees = BigInt(0);

    // Execute each swap in the path
    for (let i = 0; i < poolReserves.length; i++) {
      const reserves = poolReserves[i];
      const swap = this.calculateSwapOutput(
        currentAmount,
        reserves.reserve0,
        reserves.reserve1,
        30
      );

      const slippage = currentAmount - swap.amountOut;
      totalSlippage += slippage;
      totalFees += slippage;

      currentAmount = swap.amountOut;
    }

    // Calculate AAVE fee
    const aaveFee = (borrowAmount * BigInt(Math.floor(aaveFeePercent * 10000))) / BigInt(1000000);
    totalFees += aaveFee;

    // Calculate profit
    const totalRepay = borrowAmount + aaveFee;
    const profit = currentAmount > totalRepay ? currentAmount - totalRepay : BigInt(0);
    const profitPercent = profit > BigInt(0)
      ? Number((profit * BigInt(10000)) / borrowAmount) / 100
      : 0;

    return {
      profitAmount: profit,
      profitPercent,
      slippageLoss: totalSlippage,
      totalFees,
      intermediateAmount: currentAmount,
    };
  }

  /**
   * Calculate minimum output amount with slippage tolerance
   */
  calculateMinimumOutput(
    amountOut: bigint,
    slippageTolerancePercent: number
  ): bigint {
    const tolerance = BigInt(Math.floor(slippageTolerancePercent * 100));
    const minAmount = (amountOut * (BigInt(10000) - tolerance)) / BigInt(10000);
    return minAmount;
  }

  /**
   * Check if arbitrage is profitable after all costs
   */
  isProfitable(
    simulation: ArbitrageSimulation,
    minProfitThreshold: bigint,
    minProfitPercent: number = 0.1
  ): boolean {
    // Must exceed minimum profit threshold
    if (simulation.profitAmount < minProfitThreshold) {
      return false;
    }

    // Must exceed minimum profit percentage
    if (simulation.profitPercent < minProfitPercent) {
      return false;
    }

    // Profit must be positive
    if (simulation.profitAmount <= BigInt(0)) {
      return false;
    }

    return true;
  }

  /**
   * Get detailed breakdown of arbitrage economics
   */
  getArbitrageBreakdown(
    borrowAmount: bigint,
    simulation: ArbitrageSimulation,
    priceUSD: number
  ): {
    borrowAmountUSD: number;
    profitAmountUSD: number;
    slippageLossUSD: number;
    aaveFeeUSD: number;
    profitMarginPercent: number;
    roi: number;
  } {
    const borrowAmountUSD = Number(borrowAmount) * priceUSD;
    const profitAmountUSD = Number(simulation.profitAmount) * priceUSD;
    const slippageLossUSD = Number(simulation.slippageLoss) * priceUSD;
    const aaveFeeUSD = Number(simulation.totalFees) * priceUSD;
    const profitMarginPercent = simulation.profitPercent;
    const roi = (profitAmountUSD / borrowAmountUSD) * 100;

    return {
      borrowAmountUSD,
      profitAmountUSD,
      slippageLossUSD,
      aaveFeeUSD,
      profitMarginPercent,
      roi,
    };
  }
}
