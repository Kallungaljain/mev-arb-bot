/// Ultra-fast profit simulator for MEV arbitrage trades
/// Accounts for slippage, fees, and gas costs

#[derive(Debug, Clone)]
pub struct PoolState {
    pub reserve0: f64,
    pub reserve1: f64,
    pub fee: f64, // 0.3 for 0.3% fee
}

#[derive(Debug, Clone)]
pub struct TradeSimulation {
    pub input_amount: f64,
    pub output_amount: f64,
    pub slippage_pct: f64,
    pub total_fee_usd: f64,
    pub net_profit_usd: f64,
    pub is_profitable: bool,
}

pub struct ProfitSimulator;

impl ProfitSimulator {
    /// Simulate swap using constant product formula (x*y=k)
    pub fn simulate_swap(
        input_amount: f64,
        pool: &PoolState,
        is_token0_to_token1: bool,
    ) -> f64 {
        let (reserve_in, reserve_out) = if is_token0_to_token1 {
            (pool.reserve0, pool.reserve1)
        } else {
            (pool.reserve1, pool.reserve0)
        };

        // Apply fee
        let fee_amount = input_amount * (pool.fee / 100.0);
        let amount_in_with_fee = input_amount - fee_amount;

        // x*y=k formula: output = (y * amount_in) / (x + amount_in)
        let output = (reserve_out * amount_in_with_fee) / (reserve_in + amount_in_with_fee);

        output
    }

    /// Calculate slippage percentage
    pub fn calculate_slippage(
        input_amount: f64,
        output_amount: f64,
        expected_rate: f64,
    ) -> f64 {
        let expected_output = input_amount * expected_rate;
        if expected_output == 0.0 {
            return 0.0;
        }
        ((expected_output - output_amount) / expected_output) * 100.0
    }

    /// Simulate complete arbitrage trade
    pub fn simulate_arbitrage(
        initial_amount_usd: f64,
        pool1: &PoolState,
        pool2: &PoolState,
        gas_cost_usd: f64,
        aave_fee_pct: f64, // 0.09% for AAVE V3
    ) -> TradeSimulation {
        // Step 1: Borrow from AAVE
        let borrowed_amount = initial_amount_usd;
        let aave_fee = borrowed_amount * (aave_fee_pct / 100.0);

        // Step 2: First swap (USDC -> WMATIC on QuickSwap)
        let amount_after_first_swap = Self::simulate_swap(borrowed_amount, pool1, true);

        // Step 3: Second swap (WMATIC -> USDC on SushiSwap)
        let amount_after_second_swap = Self::simulate_swap(amount_after_first_swap, pool2, false);

        // Step 4: Repay loan
        let total_repay = borrowed_amount + aave_fee;
        let net_profit = amount_after_second_swap - total_repay - gas_cost_usd;

        // Calculate slippage
        let expected_output = borrowed_amount * 1.0; // Assume 1:1 rate without slippage
        let slippage_pct = Self::calculate_slippage(borrowed_amount, amount_after_second_swap, 1.0);

        TradeSimulation {
            input_amount: borrowed_amount,
            output_amount: amount_after_second_swap,
            slippage_pct,
            total_fee_usd: aave_fee + gas_cost_usd,
            net_profit_usd: net_profit,
            is_profitable: net_profit > 0.0,
        }
    }

    /// Quick check if trade is worth executing
    pub fn is_trade_profitable(
        simulation: &TradeSimulation,
        min_profit_usd: f64,
        max_slippage_pct: f64,
    ) -> bool {
        simulation.net_profit_usd >= min_profit_usd && simulation.slippage_pct <= max_slippage_pct
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_swap_simulation() {
        let pool = PoolState {
            reserve0: 1_000_000.0, // USDC
            reserve1: 1_850_000.0, // WMATIC
            fee: 0.3,
        };

        let output = ProfitSimulator::simulate_swap(1000.0, &pool, true);
        assert!(output > 0.0);
        assert!(output < 2000.0); // Should be less than 1000 * 2
    }

    #[test]
    fn test_arbitrage_simulation() {
        let pool1 = PoolState {
            reserve0: 1_000_000.0,
            reserve1: 1_850_000.0,
            fee: 0.3,
        };

        let pool2 = PoolState {
            reserve0: 500_000.0,
            reserve1: 900_000.0,
            fee: 0.3,
        };

        let sim = ProfitSimulator::simulate_arbitrage(1000.0, &pool1, &pool2, 5.0, 0.09);
        println!("Arbitrage simulation: {:?}", sim);
        assert!(sim.input_amount == 1000.0);
    }
}
