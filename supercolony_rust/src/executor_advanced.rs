use crate::types::*;
use crate::pheromone_advanced::AdvancedPheromoneLayer;
use crate::capital_allocator::CapitalAllocator;
use std::sync::Arc;
use instant::Instant;

/// Advanced executor worker with trade execution and profit tracking
pub struct AdvancedExecutor {
    pub id: String,
    pheromone_layer: Arc<AdvancedPheromoneLayer>,
    capital_allocator: Arc<CapitalAllocator>,
    
    /// Performance metrics
    metrics: WorkerMetrics,
    
    /// Latency tracker
    latency_tracker: LatencyTracker,
    
    /// Routes this executor is currently working on
    active_routes: Vec<String>,
    
    /// Profit tracking
    total_profit: i128,
    trade_count: u64,
}

impl AdvancedExecutor {
    pub fn new(
        id: String,
        pheromone_layer: Arc<AdvancedPheromoneLayer>,
        capital_allocator: Arc<CapitalAllocator>,
    ) -> Self {
        Self {
            id: id.clone(),
            pheromone_layer,
            capital_allocator,
            metrics: WorkerMetrics {
                worker_id: id,
                worker_type: WorkerType::Executor,
                routes_discovered: 0,
                opportunities_found: 0,
                trades_executed: 0,
                successful_trades: 0,
                total_profit: 0,
                average_latency_us: 0.0,
                p99_latency_us: 0.0,
                last_activity: chrono::Utc::now(),
            },
            latency_tracker: LatencyTracker::new(10000),
            active_routes: Vec::new(),
            total_profit: 0,
            trade_count: 0,
        }
    }

    /// Scan pheromones for profitable routes
    pub async fn scan_opportunities(&mut self) -> Vec<Opportunity> {
        let start = Instant::now();

        let mut opportunities = Vec::new();

        // Get routes sorted by pheromone intensity
        let routes_by_intensity = self.pheromone_layer.get_routes_by_intensity();

        for (route_id, intensity) in routes_by_intensity.iter().take(5) {
            // Only execute on routes with high intensity
            if *intensity > 0.5 {
                // Check if we have capital allocated
                let allocation = self.capital_allocator.get_allocation(&self.id);
                if allocation.is_none() || allocation.unwrap() == 0 {
                    continue;
                }

                // Create opportunity
                let opportunity = Opportunity {
                    id: format!("opp_{}", uuid::Uuid::new_v4()),
                    route: Route {
                        id: route_id.clone(),
                        path: vec![],
                        tokens: vec![],
                        hops: 2,
                    },
                    amount_in: (allocation.unwrap() as f64 * 0.1) as u128, // Use 10% of allocation
                    expected_profit: (intensity * 5000.0) as i128,
                    profit_percentage: intensity * 0.5,
                    detected_at: chrono::Utc::now(),
                    gas_estimate: 150000,
                };

                opportunities.push(opportunity);
                self.metrics.opportunities_found += 1;
                self.active_routes.push(route_id.clone());
            }
        }

        let latency = start.elapsed().as_micros() as u64;
        self.latency_tracker.record(latency);
        self.metrics.average_latency_us = self.latency_tracker.average();
        self.metrics.p99_latency_us = self.latency_tracker.p99();

        opportunities
    }

    /// Execute a trade
    pub async fn execute_trade(&mut self, opportunity: &Opportunity) -> Result<ExecutionResult, String> {
        let start = Instant::now();

        // Get allocated capital
        let allocation = self.capital_allocator.get_allocation(&self.id)
            .ok_or("No capital allocated")?;

        if opportunity.amount_in > allocation {
            return Err("Insufficient allocated capital".to_string());
        }

        // Simulate transaction execution
        let success = rand::random::<f64>() > 0.1; // 90% success rate
        let profit = if success {
            opportunity.expected_profit
        } else {
            -(opportunity.amount_in as i128 / 100) // 1% loss on failure
        };

        let result = ExecutionResult {
            tx_hash: format!("0x{}", uuid::Uuid::new_v4()),
            success,
            gas_used: opportunity.gas_estimate,
            profit_loss: profit,
            error: if success { None } else { Some("Execution failed".to_string()) },
            executed_at: chrono::Utc::now(),
        };

        if result.success {
            self.metrics.successful_trades += 1;
            self.total_profit += profit;
            self.metrics.total_profit = self.total_profit;
        }

        self.metrics.trades_executed += 1;
        self.trade_count += 1;

        let latency = start.elapsed().as_micros() as u64;
        self.latency_tracker.record(latency);
        self.metrics.average_latency_us = self.latency_tracker.average();
        self.metrics.p99_latency_us = self.latency_tracker.p99();
        self.metrics.last_activity = chrono::Utc::now();

        Ok(result)
    }

    /// Get executor metrics
    pub fn get_metrics(&self) -> WorkerMetrics {
        self.metrics.clone()
    }

    /// Get profit
    pub fn get_profit(&self) -> i128 {
        self.total_profit
    }

    /// Get success rate
    pub fn get_success_rate(&self) -> f64 {
        if self.trade_count == 0 {
            0.0
        } else {
            (self.metrics.successful_trades as f64 / self.trade_count as f64) * 100.0
        }
    }

    /// Get active routes
    pub fn get_active_routes(&self) -> Vec<String> {
        self.active_routes.clone()
    }

    /// Respond to pheromone signals
    pub async fn respond_to_signals(&mut self) {
        // Get best route from pheromones
        if let Some((route_id, intensity)) = self.pheromone_layer.find_best_route() {
            // Allocate more capital to this route if successful
            if intensity > 0.7 && self.get_success_rate() > 80.0 {
                // Increase allocation
                let current = self.capital_allocator.get_allocation(&self.id).unwrap_or(0);
                let increase = (current as f64 * 0.1) as u128; // Increase by 10%
                
                if let Ok(available) = Ok::<u128, String>(self.capital_allocator.get_available()) {
                    if increase <= available {
                        let _ = self.capital_allocator.allocate(self.id.clone(), increase);
                    }
                }
            }
        }

        // Avoid danger zones
        let danger_zones = self.pheromone_layer.get_danger_zones();
        self.active_routes.retain(|route| !danger_zones.contains(route));
    }
}

// Add uuid crate dependency
use uuid;
use rand;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_executor_opportunity_scanning() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let pheromone_layer = Arc::new(AdvancedPheromoneLayer::new(config));
        let capital_allocator = Arc::new(CapitalAllocator::new(1000000));

        capital_allocator.allocate("executor_1".to_string(), 100000).ok();

        let mut executor = AdvancedExecutor::new(
            "executor_1".to_string(),
            pheromone_layer.clone(),
            capital_allocator,
        );

        // Deposit a profitable route pheromone
        pheromone_layer.deposit("route_1".to_string(), "scout_1".to_string(), 0.8).await;

        let opportunities = executor.scan_opportunities().await;
        assert!(!opportunities.is_empty());
    }

    #[tokio::test]
    async fn test_executor_trade_execution() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let pheromone_layer = Arc::new(AdvancedPheromoneLayer::new(config));
        let capital_allocator = Arc::new(CapitalAllocator::new(1000000));

        capital_allocator.allocate("executor_1".to_string(), 100000).ok();

        let mut executor = AdvancedExecutor::new(
            "executor_1".to_string(),
            pheromone_layer,
            capital_allocator,
        );

        let opportunity = Opportunity {
            id: "opp_1".to_string(),
            route: Route {
                id: "route_1".to_string(),
                path: vec![],
                tokens: vec![],
                hops: 2,
            },
            amount_in: 10000,
            expected_profit: 500,
            profit_percentage: 0.05,
            detected_at: chrono::Utc::now(),
            gas_estimate: 150000,
        };

        let result = executor.execute_trade(&opportunity).await;
        assert!(result.is_ok());
    }
}
