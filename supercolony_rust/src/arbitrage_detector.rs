use crate::alchemy_integration::PoolState;
use dashmap::DashMap;
use std::sync::Arc;

/// Detected arbitrage opportunity
#[derive(Clone, Debug)]
pub struct ArbitrageOpportunity {
    pub id: String,
    pub route: Vec<String>,  // [TokenA, TokenB, TokenC, TokenA]
    pub pools: Vec<String>,  // Pool addresses in route
    pub input_amount: u128,
    pub expected_output: u128,
    pub profit_amount: u128,
    pub profit_percentage: f64,
    pub gas_cost_estimate: u128,
    pub net_profit: i128,
    pub confidence: f64,  // 0.0-1.0
    pub timestamp: u64,
}

/// Real arbitrage detection engine
pub struct ArbitrageDetector {
    pools: Arc<DashMap<String, PoolState>>,
    opportunities: Arc<DashMap<String, ArbitrageOpportunity>>,
    min_profit_threshold: u128,
}

impl ArbitrageDetector {
    pub fn new(min_profit_threshold: u128) -> Self {
        Self {
            pools: Arc::new(DashMap::new()),
            opportunities: Arc::new(DashMap::new()),
            min_profit_threshold,
        }
    }

    /// Update pool state
    pub fn update_pool(&self, pool: PoolState) {
        self.pools.insert(pool.address.clone(), pool);
    }

    /// Detect 2-hop arbitrage opportunities (A -> B -> A)
    pub fn detect_2_hop_opportunities(&self) -> Vec<ArbitrageOpportunity> {
        let mut opportunities = Vec::new();
        let pools: Vec<_> = self.pools.iter().map(|p| p.value().clone()).collect();

        // For each pair of pools
        for i in 0..pools.len() {
            for j in i + 1..pools.len() {
                let pool1 = &pools[i];
                let pool2 = &pools[j];

                // Check if they share a token
                if pool1.token1 == pool2.token0 {
                    // Route: token0_1 -> token1_1 -> token0_2
                    if let Some(opp) = self.calculate_2_hop_profit(pool1, pool2) {
                        opportunities.push(opp);
                    }
                }

                if pool1.token0 == pool2.token1 {
                    // Reverse route
                    if let Some(opp) = self.calculate_2_hop_profit_reverse(pool1, pool2) {
                        opportunities.push(opp);
                    }
                }
            }
        }

        // Sort by profit
        opportunities.sort_by(|a, b| b.profit_amount.cmp(&a.profit_amount));
        opportunities
    }

    /// Detect 3-hop arbitrage opportunities (A -> B -> C -> A)
    pub fn detect_3_hop_opportunities(&self) -> Vec<ArbitrageOpportunity> {
        let mut opportunities = Vec::new();
        let pools: Vec<_> = self.pools.iter().map(|p| p.value().clone()).collect();

        // For each triplet of pools
        for i in 0..pools.len() {
            for j in 0..pools.len() {
                if i == j {
                    continue;
                }
                for k in 0..pools.len() {
                    if k == i || k == j {
                        continue;
                    }

                    let pool1 = &pools[i];
                    let pool2 = &pools[j];
                    let pool3 = &pools[k];

                    // Check if route is valid
                    if pool1.token1 == pool2.token0 && pool2.token1 == pool3.token0 && pool3.token1 == pool1.token0 {
                        if let Some(opp) = self.calculate_3_hop_profit(pool1, pool2, pool3) {
                            opportunities.push(opp);
                        }
                    }
                }
            }
        }

        // Sort by profit
        opportunities.sort_by(|a, b| b.profit_amount.cmp(&a.profit_amount));
        opportunities
    }

    /// Calculate profit for 2-hop route
    fn calculate_2_hop_profit(&self, pool1: &PoolState, pool2: &PoolState) -> Option<ArbitrageOpportunity> {
        let input_amount = 1_000_000_000_000_000_000u128; // 1 token

        // Swap on pool1: token0 -> token1
        let intermediate = self.calculate_swap_output(input_amount, pool1.reserve0, pool1.reserve1);

        // Swap on pool2: token1 -> token0
        let output = self.calculate_swap_output(intermediate, pool2.reserve1, pool2.reserve0);

        // Calculate profit
        let profit = if output > input_amount {
            output - input_amount
        } else {
            return None;
        };

        let profit_percentage = (profit as f64 / input_amount as f64) * 100.0;
        let gas_cost = 150_000_000_000_000u128; // ~0.15 ETH in wei

        if profit < self.min_profit_threshold {
            return None;
        }

        let net_profit = profit as i128 - gas_cost as i128;
        if net_profit <= 0 {
            return None;
        }

        let id = format!(
            "2hop_{}_{}_{}",
            pool1.token0, pool1.token1, pool2.token0
        );

        Some(ArbitrageOpportunity {
            id,
            route: vec![pool1.token0.clone(), pool1.token1.clone(), pool1.token0.clone()],
            pools: vec![pool1.address.clone(), pool2.address.clone()],
            input_amount,
            expected_output: output,
            profit_amount: profit,
            profit_percentage,
            gas_cost_estimate: gas_cost,
            net_profit,
            confidence: (profit_percentage / 10.0).min(1.0),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        })
    }

    /// Calculate profit for 2-hop route (reverse)
    fn calculate_2_hop_profit_reverse(&self, pool1: &PoolState, pool2: &PoolState) -> Option<ArbitrageOpportunity> {
        let input_amount = 1_000_000_000_000_000_000u128;

        // Swap on pool1: token1 -> token0
        let intermediate = self.calculate_swap_output(input_amount, pool1.reserve1, pool1.reserve0);

        // Swap on pool2: token0 -> token1
        let output = self.calculate_swap_output(intermediate, pool2.reserve0, pool2.reserve1);

        let profit = if output > input_amount {
            output - input_amount
        } else {
            return None;
        };

        let profit_percentage = (profit as f64 / input_amount as f64) * 100.0;
        let gas_cost = 150_000_000_000_000u128;

        if profit < self.min_profit_threshold {
            return None;
        }

        let net_profit = profit as i128 - gas_cost as i128;
        if net_profit <= 0 {
            return None;
        }

        let id = format!(
            "2hop_rev_{}_{}_{}",
            pool1.token1, pool1.token0, pool2.token1
        );

        Some(ArbitrageOpportunity {
            id,
            route: vec![pool1.token1.clone(), pool1.token0.clone(), pool1.token1.clone()],
            pools: vec![pool1.address.clone(), pool2.address.clone()],
            input_amount,
            expected_output: output,
            profit_amount: profit,
            profit_percentage,
            gas_cost_estimate: gas_cost,
            net_profit,
            confidence: (profit_percentage / 10.0).min(1.0),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        })
    }

    /// Calculate profit for 3-hop route
    fn calculate_3_hop_profit(
        &self,
        pool1: &PoolState,
        pool2: &PoolState,
        pool3: &PoolState,
    ) -> Option<ArbitrageOpportunity> {
        let input_amount = 1_000_000_000_000_000_000u128;

        // Swap 1: token0 -> token1
        let intermediate1 = self.calculate_swap_output(input_amount, pool1.reserve0, pool1.reserve1);

        // Swap 2: token1 -> token2
        let intermediate2 = self.calculate_swap_output(intermediate1, pool2.reserve0, pool2.reserve1);

        // Swap 3: token2 -> token0
        let output = self.calculate_swap_output(intermediate2, pool3.reserve0, pool3.reserve1);

        let profit = if output > input_amount {
            output - input_amount
        } else {
            return None;
        };

        let profit_percentage = (profit as f64 / input_amount as f64) * 100.0;
        let gas_cost = 250_000_000_000_000u128; // More expensive for 3-hop

        if profit < self.min_profit_threshold {
            return None;
        }

        let net_profit = profit as i128 - gas_cost as i128;
        if net_profit <= 0 {
            return None;
        }

        let id = format!(
            "3hop_{}_{}_{}_{}",
            pool1.token0, pool1.token1, pool2.token1, pool3.token1
        );

        Some(ArbitrageOpportunity {
            id,
            route: vec![
                pool1.token0.clone(),
                pool1.token1.clone(),
                pool2.token1.clone(),
                pool1.token0.clone(),
            ],
            pools: vec![
                pool1.address.clone(),
                pool2.address.clone(),
                pool3.address.clone(),
            ],
            input_amount,
            expected_output: output,
            profit_amount: profit,
            profit_percentage,
            gas_cost_estimate: gas_cost,
            net_profit,
            confidence: (profit_percentage / 10.0).min(1.0),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        })
    }

    /// Calculate swap output using AMM formula: x * y = k
    fn calculate_swap_output(&self, amount_in: u128, reserve_in: u128, reserve_out: u128) -> u128 {
        // Uniswap V2 formula with 0.3% fee
        let fee_bps = 3; // 0.3%
        let amount_in_with_fee = amount_in * (10000 - fee_bps) / 10000;

        let numerator = amount_in_with_fee as u128 * reserve_out as u128;
        let denominator = reserve_in as u128 + amount_in_with_fee as u128;

        numerator / denominator
    }

    /// Score opportunity for pheromone intensity
    pub fn score_opportunity(&self, opp: &ArbitrageOpportunity) -> f64 {
        // Score based on:
        // - Profit percentage (higher is better)
        // - Net profit after gas (higher is better)
        // - Confidence (higher is better)

        let profit_score = (opp.profit_percentage / 10.0).min(1.0);
        let net_profit_score = if opp.net_profit > 0 {
            (opp.net_profit as f64 / 1_000_000_000_000_000_000f64).min(1.0)
        } else {
            0.0
        };

        (profit_score * 0.5 + net_profit_score * 0.5) * opp.confidence
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_2_hop_detection() {
        let detector = ArbitrageDetector::new(1_000_000_000_000_000u128);

        let pool1 = PoolState {
            address: "0x1111".to_string(),
            reserve0: 1_000_000_000_000_000_000,
            reserve1: 500_000_000_000_000_000,
            token0: "WMATIC".to_string(),
            token1: "USDC".to_string(),
            last_updated: 0,
        };

        let pool2 = PoolState {
            address: "0x2222".to_string(),
            reserve0: 500_000_000_000_000_000,
            reserve1: 1_050_000_000_000_000_000,
            token0: "USDC".to_string(),
            token1: "WMATIC".to_string(),
            last_updated: 0,
        };

        detector.update_pool(pool1);
        detector.update_pool(pool2);

        let opportunities = detector.detect_2_hop_opportunities();
        assert!(!opportunities.is_empty());
    }
}
