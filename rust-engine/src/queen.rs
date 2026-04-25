use crate::types::*;
use std::collections::HashMap;

/// Queen: MEV Risk Analyzer
/// Analyzes the 5% risky trades and decides whether to execute them
pub struct Queen {
    config: QueenConfig,
}

impl Queen {
    pub fn new(config: QueenConfig) -> Self {
        Queen { config }
    }

    /// Analyze MEV risk for an opportunity
    pub fn analyze_risk(&self, opportunity: &ArbitrageOpportunity, pool_states: &[PoolState]) -> MEVRiskAnalysis {
        let sandwich_risk = self.calculate_sandwich_risk(opportunity, pool_states);
        let slippage_risk = self.calculate_slippage_risk(opportunity, pool_states);
        let liquidity_risk = self.calculate_liquidity_risk(opportunity, pool_states);
        let gas_price_risk = self.calculate_gas_price_risk();

        let overall_score = (sandwich_risk * 0.4 + slippage_risk * 0.3 + liquidity_risk * 0.2 + gas_price_risk * 0.1) / 100.0;

        let recommendation = if overall_score > self.config.mev_risk_threshold {
            "risky".to_string()
        } else {
            "safe".to_string()
        };

        let mut details = HashMap::new();
        details.insert("sandwich_risk".to_string(), format!("{:.2}%", sandwich_risk));
        details.insert("slippage_risk".to_string(), format!("{:.2}%", slippage_risk));
        details.insert("liquidity_risk".to_string(), format!("{:.2}%", liquidity_risk));
        details.insert("gas_price_risk".to_string(), format!("{:.2}%", gas_price_risk));

        MEVRiskAnalysis {
            sandwich_risk,
            slippage_risk,
            liquidity_risk,
            gas_price_risk,
            overall_score,
            recommendation,
            details,
        }
    }

    /// Calculate sandwich attack risk
    /// Higher risk = more likely to be sandwiched
    fn calculate_sandwich_risk(&self, opportunity: &ArbitrageOpportunity, pool_states: &[PoolState]) -> f64 {
        let mut risk = 0.0;

        // Factor 1: Profit size (larger profit = more attractive to sandwich)
        if opportunity.profit_usd > 1000.0 {
            risk += 30.0;
        } else if opportunity.profit_usd > 500.0 {
            risk += 20.0;
        } else if opportunity.profit_usd > 100.0 {
            risk += 10.0;
        }

        // Factor 2: Number of hops (more hops = more complex = higher risk)
        let hops = opportunity.path.len();
        if hops > 4 {
            risk += 25.0;
        } else if hops > 3 {
            risk += 15.0;
        } else if hops > 2 {
            risk += 5.0;
        }

        // Factor 3: Pool liquidity (low liquidity = easier to sandwich)
        for pool in pool_states {
            let liquidity = (pool.reserve0.min(pool.reserve1)) as f64;
            if liquidity < 100_000.0 {
                risk += 20.0;
            } else if liquidity < 1_000_000.0 {
                risk += 10.0;
            }
        }

        // Factor 4: Profit margin (tight margin = more risky)
        if opportunity.profit_percent < 0.3 {
            risk += 25.0;
        } else if opportunity.profit_percent < 0.5 {
            risk += 15.0;
        } else if opportunity.profit_percent < 1.0 {
            risk += 5.0;
        }

        risk.min(100.0_f64)
    }

    /// Calculate slippage risk
    /// Risk of price moving against us during execution
    fn calculate_slippage_risk(&self, opportunity: &ArbitrageOpportunity, pool_states: &[PoolState]) -> f64 {
        let mut risk = 0.0;

        // Factor 1: Pool size (smaller pools = higher slippage)
        for pool in pool_states {
            let pool_size = ((pool.reserve0 as f64) * (pool.reserve1 as f64)).sqrt();
            if pool_size < 1_000_000.0 {
                risk += 30.0;
            } else if pool_size < 10_000_000.0 {
                risk += 15.0;
            } else if pool_size < 100_000_000.0 {
                risk += 5.0;
            }
        }

        // Factor 2: Loan amount (larger loans = higher slippage)
        // This would be calculated based on actual loan amount
        risk += 10.0;

        // Factor 3: Profit margin (tight margin = more slippage risk)
        if opportunity.profit_percent < 0.5 {
            risk += 20.0;
        } else if opportunity.profit_percent < 1.0 {
            risk += 10.0;
        }

        risk.min(100.0_f64)
    }

    /// Calculate liquidity risk
    /// Risk of not having enough liquidity to execute all swaps
    fn calculate_liquidity_risk(&self, opportunity: &ArbitrageOpportunity, pool_states: &[PoolState]) -> f64 {
        let mut risk = 0.0;

        for pool in pool_states {
            let min_reserve = pool.reserve0.min(pool.reserve1) as f64;
            
            if min_reserve < 10_000_000_000_000_000_000.0 {
                risk += 25.0;
            } else if min_reserve < 100_000_000_000_000_000_000.0 {
                risk += 15.0;
            } else if min_reserve < 1_000_000_000_000_000_000_000.0 {
                risk += 5.0;
            }
        }

        // Factor: Number of hops (more hops = more liquidity needed)
        let hops = opportunity.path.len();
        risk += (hops as f64 - 2.0) * 5.0;

        risk.min(100.0_f64)
    }

    /// Calculate gas price risk
    /// Risk of gas price being too high
    fn calculate_gas_price_risk(&self) -> f64 {
        // This would be calculated based on current gas price
        // For now, return a default value
        5.0
    }

    /// Decide whether to executea risky trade
    pub fn should_execute_risky_trade(&self, analysis: &MEVRiskAnalysis) -> bool {
        // Execute if:
        // 1. Overall score is below threshold
        // 2. No single risk factor is above its threshold
        // 3. Sandwich risk is not too high

        if analysis.overall_score > self.config.mev_risk_threshold {
            return false;
        }

        if analysis.sandwich_risk > self.config.sandwich_risk_threshold {
            return false;
        }

        if analysis.slippage_risk > self.config.slippage_risk_threshold {
            return false;
        }

        if self.config.require_human_approval {
            // In production, this would send a notification to the user
            tracing::warn!("Risky trade requires human approval: {:?}", analysis);
            return false;
        }

        true
    }

    /// Get risk level description
    pub fn get_risk_level(&self, score: f64) -> String {
        match score {
            0.0..=20.0 => "very_low".to_string(),
            20.0..=40.0 => "low".to_string(),
            40.0..=60.0 => "medium".to_string(),
            60.0..=80.0 => "high".to_string(),
            _ => "very_high".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queen_initialization() {
        let config = QueenConfig {
            mev_risk_threshold: 60.0,
            sandwich_risk_threshold: 50.0,
            slippage_risk_threshold: 1.0,
            require_human_approval: false,
        };
        let queen = Queen::new(config);
        assert_eq!(queen.config.mev_risk_threshold, 60.0);
    }

    #[test]
    fn test_risk_level_description() {
        let config = QueenConfig {
            mev_risk_threshold: 60.0,
            sandwich_risk_threshold: 50.0,
            slippage_risk_threshold: 1.0,
            require_human_approval: false,
        };
        let queen = Queen::new(config);
        
        assert_eq!(queen.get_risk_level(10.0), "very_low");
        assert_eq!(queen.get_risk_level(30.0), "low");
        assert_eq!(queen.get_risk_level(50.0), "medium");
        assert_eq!(queen.get_risk_level(70.0), "high");
        assert_eq!(queen.get_risk_level(90.0), "very_high");
    }
}
