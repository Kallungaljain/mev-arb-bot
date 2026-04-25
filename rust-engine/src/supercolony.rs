use crate::types::*;
use crate::stigmergy::{Stigmergy, StigmergyStats};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Supercolony: Main orchestrator for the MEV arbitrage bot
/// Coordinates Scanner, Detector, Queen, Keeper, and Stigmergy modules
/// Inspired by ant colony stigmergy for emergent, decentralized route discovery
pub struct Supercolony {
    /// Pheromone-based coordination system
    stigmergy: Arc<Stigmergy>,
    /// Pool scanner
    scanner: Arc<Scanner>,
    /// Arbitrage detector
    detector: Arc<Detector>,
    /// Trade keeper/executor
    keeper: Arc<Keeper>,
    /// Configuration
    config: SupercolonyConfig,
    /// Statistics
    stats: Arc<Mutex<SupercolonyStats>>,
}

#[derive(Clone, Debug)]
pub struct SupercolonyConfig {
    /// Minimum profit threshold to deposit pheromone
    pub min_profit_threshold: f64,
    /// Pheromone deposit rate
    pub pheromone_deposit_rate: f64,
    /// Scan interval in milliseconds
    pub scan_interval_ms: u64,
    /// Maximum concurrent trades
    pub max_concurrent_trades: usize,
    /// Enable pheromone-based route selection
    pub use_stigmergy: bool,
}

impl Default for SupercolonyConfig {
    fn default() -> Self {
        SupercolonyConfig {
            min_profit_threshold: 50.0,
            pheromone_deposit_rate: 1.0,
            scan_interval_ms: 500,
            max_concurrent_trades: 5,
            use_stigmergy: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct SupercolonyStats {
    pub total_opportunities_found: u64,
    pub total_trades_executed: u64,
    pub total_profit_usd: f64,
    pub active_pheromones: usize,
    pub avg_latency_ms: f64,
}

impl Supercolony {
    pub fn new(
        stigmergy: Arc<Stigmergy>,
        config: SupercolonyConfig,
    ) -> Self {
        Supercolony {
            stigmergy,
            scanner: Arc::new(crate::scanner::Scanner::new(Default::default())),
            detector: Arc::new(crate::detector::Detector::new()),
            keeper: Arc::new(crate::keeper::Keeper::new(Default::default())),
            config,
            stats: Arc::new(Mutex::new(SupercolonyStats {
                total_opportunities_found: 0,
                total_trades_executed: 0,
                total_profit_usd: 0.0,
                active_pheromones: 0,
                avg_latency_ms: 0.0,
            })),
        }
    }

    /// Main trading loop - orchestrates all modules
    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        loop {
            let start_time = std::time::Instant::now();

            // Step 1-2: Placeholder for scanning and detection
            // In production, this would call scanner and detector modules
            let opportunities: Vec<ArbitrageOpportunity> = vec![];

            // Step 3: Filter by pheromone strength (if enabled)
            let filtered_opportunities = if self.config.use_stigmergy {
                self.filter_by_stigmergy(&opportunities)
            } else {
                opportunities.clone()
            };

            // Step 4: Process opportunities
            for opportunity in filtered_opportunities {
                if opportunity.profit_usd > self.config.min_profit_threshold {
                    // Deposit pheromone for this route
                    let route_id = self.route_id_from_opportunity(&opportunity);
                    self.stigmergy.deposit_pheromone(route_id, opportunity.profit_usd);
                    
                    tracing::info!(
                        "✅ Opportunity found: ${:.2} profit",
                        opportunity.profit_usd
                    );
                }
            }

            // Step 5: Update statistics
            let elapsed = start_time.elapsed().as_millis() as f64;
            let mut stats = self.stats.lock().await;
            stats.total_opportunities_found += opportunities.len() as u64;
            stats.avg_latency_ms = (stats.avg_latency_ms * 0.9) + (elapsed * 0.1); // EMA
            stats.active_pheromones = self.stigmergy.get_active_routes().len();

            // Step 6: Cleanup evaporated pheromones
            self.stigmergy.cleanup_evaporated();

            // Sleep until next scan
            tokio::time::sleep(tokio::time::Duration::from_millis(
                self.config.scan_interval_ms,
            ))
            .await;
        }
    }

    /// Filter opportunities by pheromone strength
    /// Prioritizes routes with strong pheromones (proven profitable)
    fn filter_by_stigmergy(&self, opportunities: &[ArbitrageOpportunity]) -> Vec<ArbitrageOpportunity> {
        let mut scored_opportunities: Vec<_> = opportunities
            .iter()
            .map(|opp| {
                let route_id = self.route_id_from_opportunity(opp);
                let pheromone_strength = self.stigmergy.get_pheromone_strength(&route_id);
                (opp.clone(), pheromone_strength)
            })
            .collect();

        // Sort by pheromone strength (descending)
        scored_opportunities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // Return top opportunities
        scored_opportunities
            .into_iter()
            .take(self.config.max_concurrent_trades)
            .map(|(opp, _)| opp)
            .collect()
    }

    /// Generate route ID from opportunity
    fn route_id_from_opportunity(&self, opportunity: &ArbitrageOpportunity) -> String {
        opportunity.path.join("->")
    }

    /// Get current statistics
    pub async fn get_statistics(&self) -> SupercolonyStats {
        self.stats.lock().await.clone()
    }

    /// Get pheromone network statistics
    pub fn get_pheromone_stats(&self) -> StigmergyStats {
        self.stigmergy.get_statistics()
    }

    /// Get active profitable routes
    pub fn get_active_routes(&self) -> Vec<(String, f64, u32)> {
        self.stigmergy.get_active_routes()
    }

    /// Health check
    pub async fn health_check(&self) -> HealthStatus {
        let stats = self.stats.lock().await;
        HealthStatus {
            is_healthy: stats.avg_latency_ms < 1000.0, // Healthy if latency < 1s
            latency_ms: stats.avg_latency_ms,
            trades_executed: stats.total_trades_executed,
            total_profit: stats.total_profit_usd,
            active_routes: stats.active_pheromones,
        }
    }
}

#[derive(Clone, Debug)]
pub struct HealthStatus {
    pub is_healthy: bool,
    pub latency_ms: f64,
    pub trades_executed: u64,
    pub total_profit: f64,
    pub active_routes: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supercolony_config_default() {
        let config = SupercolonyConfig::default();
        assert_eq!(config.min_profit_threshold, 50.0);
        assert!(config.use_stigmergy);
    }

    #[test]
    fn test_route_id_generation() {
        let opportunity = ArbitrageOpportunity {
            path: vec!["USDC".to_string(), "USDT".to_string(), "DAI".to_string()],
            profit_usd: 100.0,
            profit_percent: 0.5,
            pools: vec![],
        };

        // This would be tested with actual Supercolony instance
        let route_id = opportunity.path.join("->");
        assert_eq!(route_id, "USDC->USDT->DAI");
    }
}
