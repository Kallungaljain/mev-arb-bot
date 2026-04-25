use crate::types::*;
use crate::pheromone::{PheromoneLayer, StigmergicWorker};
use std::sync::Arc;
use instant::Instant;

/// Executor worker - executes trades on profitable routes
/// Executors read pheromones to find routes with high intensity, then execute trades
pub struct Executor {
    pub id: Id,
    pheromone_layer: Arc<PheromoneLayer>,
    
    /// Routes this executor is currently working on
    active_routes: Vec<Id>,
    
    /// Performance metrics
    metrics: WorkerMetrics,
    
    /// Latency tracker
    latency_tracker: LatencyTracker,
    
    /// Capital allocated to this executor
    allocated_capital: u128,
}

impl Executor {
    pub fn new(id: Id, pheromone_layer: Arc<PheromoneLayer>, capital: u128) -> Self {
        Self {
            id: id.clone(),
            pheromone_layer,
            active_routes: Vec::new(),
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
            allocated_capital: capital,
        }
    }

    /// Executor scans pheromones to find profitable routes
    /// This is the "foraging" behavior - following pheromone trails
    pub async fn scan_for_opportunities(&mut self) -> Vec<Opportunity> {
        let start = Instant::now();

        let mut opportunities = Vec::new();

        // Get all active routes from pheromone layer
        let active_routes = self.pheromone_layer.get_active_routes();

        for route_id in active_routes {
            // Check pheromone intensity
            let intensity = self.pheromone_layer.get_route_intensity(&route_id);

            // Only execute on routes with high pheromone intensity
            // (This is stigmergy: executor follows pheromone trails)
            if intensity > 0.6 {
                // Simulate opportunity detection
                let opportunity = Opportunity {
                    id: format!("opp_{}", uuid::Uuid::new_v4()),
                    route: Route {
                        id: route_id.clone(),
                        path: vec![],
                        tokens: vec![],
                        hops: 2,
                    },
                    amount_in: 1000000,
                    expected_profit: (intensity * 5000.0) as i128,
                    profit_percentage: intensity * 0.5,
                    detected_at: chrono::Utc::now(),
                    gas_estimate: 150000,
                };

                opportunities.push(opportunity);
                self.metrics.opportunities_found += 1;
            }
        }

        let latency = start.elapsed().as_micros() as u64;
        self.latency_tracker.record(latency);
        self.metrics.average_latency_us = self.latency_tracker.average();
        self.metrics.p99_latency_us = self.latency_tracker.p99();

        opportunities
    }

    /// Execute a trade on an opportunity
    pub async fn execute_trade(&mut self, opportunity: &Opportunity) -> Result<ExecutionResult, String> {
        let start = Instant::now();

        // Check if we have enough capital
        if opportunity.amount_in > self.allocated_capital {
            return Err("Insufficient capital".to_string());
        }

        // Simulate transaction execution
        let result = ExecutionResult {
            tx_hash: format!("0x{}", uuid::Uuid::new_v4()),
            success: true,
            gas_used: opportunity.gas_estimate,
            profit_loss: opportunity.expected_profit,
            error: None,
            executed_at: chrono::Utc::now(),
        };

        if result.success {
            self.metrics.successful_trades += 1;
            self.metrics.total_profit += result.profit_loss;
            self.allocated_capital -= opportunity.amount_in;
            self.allocated_capital += (opportunity.amount_in as i128 + result.profit_loss) as u128;
        }

        self.metrics.trades_executed += 1;

        let latency = start.elapsed().as_micros() as u64;
        self.latency_tracker.record(latency);
        self.metrics.average_latency_us = self.latency_tracker.average();
        self.metrics.p99_latency_us = self.latency_tracker.p99();

        Ok(result)
    }

    /// Executor responds to pheromones
    pub async fn respond_to_pheromone(&mut self, pheromone: &Pheromone) {
        match pheromone.signal_type {
            SignalType::ProfitableRoute => {
                // Add to active routes if not already there
                if !self.active_routes.contains(&pheromone.route_id) {
                    self.active_routes.push(pheromone.route_id.clone());
                }
            }
            SignalType::UnprofitableRoute => {
                // Remove from active routes
                self.active_routes
                    .retain(|id| id != &pheromone.route_id);
            }
            SignalType::DangerZone => {
                // Avoid this route
                self.active_routes
                    .retain(|id| id != &pheromone.route_id);
            }
            _ => {}
        }
    }

    /// Get executor metrics
    pub fn get_metrics(&self) -> WorkerMetrics {
        self.metrics.clone()
    }

    /// Get allocated capital
    pub fn get_capital(&self) -> u128 {
        self.allocated_capital
    }
}

#[async_trait::async_trait]
impl StigmergicWorker for Executor {
    async fn on_pheromone(&self, pheromone: &Pheromone) {
        // Executors read pheromones to understand which routes are profitable
    }

    async fn update_from_environment(&self, pheromone_layer: &PheromoneLayer) {
        // Executor checks pheromone intensities to decide which routes to focus on
        let active_routes = pheromone_layer.get_active_routes();
        
        for route_id in active_routes {
            let intensity = pheromone_layer.get_route_intensity(&route_id);
            // High intensity = many scouts found this route profitable
            // Executor should prioritize this route
        }
    }
}

// Add uuid crate dependency
use uuid;

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

        let pheromone_layer = Arc::new(PheromoneLayer::new(config));
        let mut executor = Executor::new("executor_1".to_string(), pheromone_layer.clone(), 100000);

        // Deposit a profitable route pheromone
        let _ = pheromone_layer
            .deposit_profitable_route("route_1".to_string(), "scout_1".to_string(), 0.8)
            .await;

        // Executor should find opportunities
        let opportunities = executor.scan_for_opportunities().await;
        assert!(!opportunities.is_empty());
    }
}
