/// Ultra-fast Keeper trade executor
/// Optimized for <5ms execution time

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub success: bool,
    pub tx_hash: String,
    pub gas_used: u64,
    pub profit: f64,
    pub execution_time_ms: f64,
}

/// Keeper ultra-fast executor
pub struct Keeper {
    max_gas_price: f64,
    max_slippage: f64,
}

impl Keeper {
    pub fn new() -> Self {
        Self {
            max_gas_price: 500.0,
            max_slippage: 0.5,
        }
    }

    /// Execute trade with minimal latency
    #[inline]
    pub fn execute(&self, path: &[&str], amounts: &[f64], profit_usd: f64) -> ExecutionResult {
        let start = std::time::Instant::now();

        // Validate inputs
        if path.len() < 2 || amounts.len() != path.len() {
            return ExecutionResult {
                success: false,
                tx_hash: String::new(),
                gas_used: 0,
                profit: 0.0,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        // Calculate gas needed
        let gas_needed = self.estimate_gas(path.len());

        // Build transaction
        let tx_hash = self.build_transaction(path, amounts);

        // Simulate execution
        let profit = profit_usd * 0.95; // 5% gas cost

        ExecutionResult {
            success: true,
            tx_hash,
            gas_used: gas_needed,
            profit,
            execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        }
    }

    /// Estimate gas for swap path
    #[inline]
    fn estimate_gas(&self, path_length: usize) -> u64 {
        // Base gas: 21000
        // Per swap: ~100000
        21000 + (path_length as u64 - 1) * 100000
    }

    /// Build transaction calldata
    #[inline]
    fn build_transaction(&self, path: &[&str], _amounts: &[f64]) -> String {
        // Simplified: return mock tx hash
        format!(
            "0x{:x}",
            path.iter().map(|t| t.len()).sum::<usize>() as u64
        )
    }

    /// Validate execution parameters
    #[inline]
    pub fn validate(&self, profit_usd: f64, gas_price: f64, slippage: f64) -> bool {
        profit_usd > 0.0 && gas_price <= self.max_gas_price && slippage <= self.max_slippage
    }

    /// Set max gas price
    pub fn set_max_gas_price(&mut self, max_gas_price: f64) {
        self.max_gas_price = max_gas_price;
    }

    /// Set max slippage
    pub fn set_max_slippage(&mut self, max_slippage: f64) {
        self.max_slippage = max_slippage;
    }
}

impl Default for Keeper {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keeper_creation() {
        let keeper = Keeper::new();
        assert_eq!(keeper.max_gas_price, 500.0);
    }

    #[test]
    fn test_execute_simple_swap() {
        let keeper = Keeper::new();
        let path = vec!["USDC", "WMATIC", "USDC"];
        let amounts = vec![100.0, 185.0, 100.0];

        let result = keeper.execute(&path, &amounts, 2.0);

        assert!(result.success);
        assert!(result.execution_time_ms < 5.0);
        assert!(result.profit > 0.0);
    }

    #[test]
    fn test_gas_estimation() {
        let keeper = Keeper::new();

        let gas_2_hop = keeper.estimate_gas(2);
        let gas_3_hop = keeper.estimate_gas(3);

        assert!(gas_3_hop > gas_2_hop);
        assert_eq!(gas_2_hop, 121000);
        assert_eq!(gas_3_hop, 221000);
    }

    #[test]
    fn test_validation() {
        let keeper = Keeper::new();

        assert!(keeper.validate(2.0, 100.0, 0.3));
        assert!(!keeper.validate(-1.0, 100.0, 0.3));
        assert!(!keeper.validate(2.0, 600.0, 0.3));
        assert!(!keeper.validate(2.0, 100.0, 1.0));
    }
}
