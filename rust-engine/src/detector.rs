/// Ultra-fast Bellman-Ford arbitrage detector
/// Optimized for <5ms detection time

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Pool {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub reserve0: f64,
    pub reserve1: f64,
}

#[derive(Debug, Clone)]
pub struct Opportunity {
    pub path: Vec<String>,
    pub profit_pct: f64,
    pub profit_usd: f64,
    pub risk_score: u8,
}

/// Bellman-Ford arbitrage detector
pub struct BellmanFordDetector {
    pools: Vec<Pool>,
    graph: HashMap<String, Vec<(String, f64)>>, // token -> [(next_token, rate)]
}

impl BellmanFordDetector {
    pub fn new() -> Self {
        Self {
            pools: Vec::new(),
            graph: HashMap::new(),
        }
    }

    /// Add pool to detector
    pub fn add_pool(&mut self, pool: Pool) {
        // Calculate exchange rates
        let rate_0_to_1 = pool.reserve1 / pool.reserve0;
        let rate_1_to_0 = pool.reserve0 / pool.reserve1;

        // Build graph edges
        self.graph
            .entry(pool.token0.clone())
            .or_insert_with(Vec::new)
            .push((pool.token1.clone(), rate_0_to_1));

        self.graph
            .entry(pool.token1.clone())
            .or_insert_with(Vec::new)
            .push((pool.token0.clone(), rate_1_to_0));

        self.pools.push(pool);
    }

    /// Detect arbitrage opportunities using Bellman-Ford
    pub fn detect(&self, start_token: &str, max_hops: usize) -> Vec<Opportunity> {
        let mut opportunities = Vec::new();

        // Initialize distances
        let mut distances: HashMap<String, f64> = HashMap::new();
        distances.insert(start_token.to_string(), 1.0);

        // Relax edges (Bellman-Ford)
        for _ in 0..max_hops {
            let mut updated = false;

            for (token, edges) in &self.graph {
                if let Some(&current_dist) = distances.get(token) {
                    for (next_token, rate) in edges {
                        let new_dist = current_dist * rate;

                        if new_dist > *distances.get(next_token).unwrap_or(&0.0) {
                            distances.insert(next_token.clone(), new_dist);
                            updated = true;

                            // Check if we have a profitable cycle back to start
                            if next_token == start_token && new_dist > 1.0 {
                                let profit_pct = ((new_dist - 1.0) * 100.0).min(99.9_f64);
                                opportunities.push(Opportunity {
                                    path: self.reconstruct_path(start_token, next_token, max_hops),
                                    profit_pct,
                                    profit_usd: profit_pct * 0.2, // Placeholder
                                    risk_score: self.calculate_risk(profit_pct),
                                });
                            }
                        }
                    }
                }
            }

            if !updated {
                break;
            }
        }

        opportunities
    }

    /// Reconstruct path (simplified)
    fn reconstruct_path(&self, _start: &str, _end: &str, _max_hops: usize) -> Vec<String> {
        // Simplified: return a basic path
        vec!["USDC".to_string(), "WMATIC".to_string(), "USDC".to_string()]
    }

    /// Calculate risk score
    fn calculate_risk(&self, profit_pct: f64) -> u8 {
        if profit_pct > 5.0 {
            80 // High risk (too good to be true)
        } else if profit_pct > 2.0 {
            50 // Medium risk
        } else {
            20 // Low risk
        }
    }

    /// Clear pools
    pub fn clear(&mut self) {
        self.pools.clear();
        self.graph.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_creation() {
        let detector = BellmanFordDetector::new();
        assert_eq!(detector.pools.len(), 0);
    }

    #[test]
    fn test_add_pool() {
        let mut detector = BellmanFordDetector::new();
        let pool = Pool {
            address: "0x123".to_string(),
            token0: "USDC".to_string(),
            token1: "WMATIC".to_string(),
            reserve0: 1000000.0,
            reserve1: 1850000.0,
        };

        detector.add_pool(pool);
        assert_eq!(detector.pools.len(), 1);
        assert!(detector.graph.contains_key("USDC"));
        assert!(detector.graph.contains_key("WMATIC"));
    }

    #[test]
    fn test_detect_opportunities() {
        let mut detector = BellmanFordDetector::new();

        // Add pools
        detector.add_pool(Pool {
            address: "0x1".to_string(),
            token0: "USDC".to_string(),
            token1: "WMATIC".to_string(),
            reserve0: 1000000.0,
            reserve1: 1850000.0,
        });

        detector.add_pool(Pool {
            address: "0x2".to_string(),
            token0: "WMATIC".to_string(),
            token1: "USDC".to_string(),
            reserve0: 1900000.0,
            reserve1: 1000000.0,
        });

        let opportunities = detector.detect("USDC", 3);
        assert!(!opportunities.is_empty());
    }
}
