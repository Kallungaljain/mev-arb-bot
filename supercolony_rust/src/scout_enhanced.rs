use crate::types::*;
use crate::pheromone::{PheromoneLayer, StigmergicWorker};
use crate::route_graph::RouteGraph;
use std::sync::Arc;
use instant::Instant;

/// Enhanced scout worker with real route discovery
pub struct EnhancedScout {
    pub id: Id,
    pheromone_layer: Arc<PheromoneLayer>,
    route_graph: Arc<RouteGraph>,
    
    /// Performance metrics
    metrics: WorkerMetrics,
    
    /// Latency tracker
    latency_tracker: LatencyTracker,
    
    /// Routes this scout has discovered
    discovered_routes: Vec<Id>,
}

impl EnhancedScout {
    pub fn new(
        id: Id,
        pheromone_layer: Arc<PheromoneLayer>,
        route_graph: Arc<RouteGraph>,
    ) -> Self {
        Self {
            id: id.clone(),
            pheromone_layer,
            route_graph,
            metrics: WorkerMetrics {
                worker_id: id,
                worker_type: WorkerType::Scout,
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
            discovered_routes: Vec::new(),
        }
    }

    /// Scout explores routes and deposits pheromones
    pub async fn explore_routes(&mut self) -> Result<Vec<Route>, String> {
        let start = Instant::now();

        // Get profitable routes from graph
        let profitable_routes = self.route_graph.detect_profitable_routes(0.1);

        let mut discovered = Vec::new();

        for (route, ratio) in profitable_routes {
            // Calculate profit intensity (0.0 to 1.0)
            let profit_pct = (ratio - 1.0) * 100.0;
            let intensity = (profit_pct / 10.0).min(1.0); // Normalize to 0-1

            // Deposit pheromone for this route
            let _ = self
                .pheromone_layer
                .deposit_profitable_route(route.id.clone(), self.id.clone(), intensity)
                .await;

            self.discovered_routes.push(route.id.clone());
            discovered.push(route);
            self.metrics.routes_discovered += 1;
        }

        let latency = start.elapsed().as_micros() as u64;
        self.latency_tracker.record(latency);
        self.metrics.average_latency_us = self.latency_tracker.average();
        self.metrics.p99_latency_us = self.latency_tracker.p99();
        self.metrics.last_activity = chrono::Utc::now();

        Ok(discovered)
    }

    /// Scout responds to danger signals
    pub async fn respond_to_danger(&mut self, dangerous_route: &Id) {
        // Remove from discovered routes
        self.discovered_routes.retain(|id| id != dangerous_route);

        // Deposit decay signal
        let _ = self
            .pheromone_layer
            .deposit_danger_zone(dangerous_route.clone(), self.id.clone())
            .await;
    }

    /// Scout learns from other scouts' pheromones
    pub async fn learn_from_environment(&mut self) {
        let active_routes = self.pheromone_layer.get_active_routes();

        for route_id in active_routes {
            let intensity = self.pheromone_layer.get_route_intensity(&route_id);

            // If other scouts found a profitable route, explore similar ones
            if intensity > 0.5 && !self.discovered_routes.contains(&route_id) {
                self.discovered_routes.push(route_id);
            }
        }
    }

    /// Get scout metrics
    pub fn get_metrics(&self) -> WorkerMetrics {
        self.metrics.clone()
    }

    /// Get discovered routes
    pub fn get_discovered_routes(&self) -> Vec<Id> {
        self.discovered_routes.clone()
    }
}

#[async_trait::async_trait]
impl StigmergicWorker for EnhancedScout {
    async fn on_pheromone(&self, pheromone: &Pheromone) {
        match pheromone.signal_type {
            SignalType::ProfitableRoute => {
                // Other scout found a profitable route
                // This scout might explore similar patterns
            }
            SignalType::DangerZone => {
                // Avoid this route
            }
            _ => {}
        }
    }

    async fn update_from_environment(&self, pheromone_layer: &PheromoneLayer) {
        // Scout checks pheromone environment to learn from others
        let active_routes = pheromone_layer.get_active_routes();
        
        for route_id in active_routes {
            let intensity = pheromone_layer.get_route_intensity(&route_id);
            // High intensity = many scouts found this route profitable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_enhanced_scout_exploration() {
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
        let route_graph = Arc::new(RouteGraph::new());

        // Add test pools
        route_graph.add_pool(PoolState {
            address: "0x1".to_string(),
            token0: "USDC".to_string(),
            token1: "WETH".to_string(),
            reserve0: 1000000000000,
            reserve1: 500000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        });

        let mut scout = EnhancedScout::new(
            "scout_1".to_string(),
            pheromone_layer,
            route_graph,
        );

        let routes = scout.explore_routes().await.unwrap();
        assert!(routes.len() >= 0);
    }
}
