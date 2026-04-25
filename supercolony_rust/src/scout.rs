use crate::types::*;
use crate::pheromone::{PheromoneLayer, StigmergicWorker};
use std::sync::Arc;
use instant::Instant;

/// Scout worker - discovers profitable routes
/// Scouts explore the pool graph and deposit pheromones when they find profitable paths
pub struct Scout {
    pub id: Id,
    pheromone_layer: Arc<PheromoneLayer>,
    
    /// Routes this scout has discovered
    discovered_routes: Vec<Route>,
    
    /// Performance metrics
    metrics: WorkerMetrics,
    
    /// Latency tracker
    latency_tracker: LatencyTracker,
}

impl Scout {
    pub fn new(id: Id, pheromone_layer: Arc<PheromoneLayer>) -> Self {
        Self {
            id: id.clone(),
            pheromone_layer,
            discovered_routes: Vec::new(),
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
        }
    }

    /// Scout explores the pool graph to find profitable routes
    /// This is the "foraging" behavior of ants
    pub async fn explore_routes(&mut self, pools: &[PoolState]) -> Vec<Route> {
        let start = Instant::now();

        let mut new_routes = Vec::new();

        // Simple 2-3 hop route discovery
        for (i, pool1) in pools.iter().enumerate() {
            for (j, pool2) in pools.iter().enumerate().skip(i + 1) {
                // 2-hop route
                let route_2hop = Route {
                    id: format!("route_{}_{}", i, j),
                    path: vec![pool1.address.clone(), pool2.address.clone()],
                    tokens: vec![pool1.token0.clone(), pool1.token1.clone(), pool2.token1.clone()],
                    hops: 2,
                };

                // Check if profitable (simplified)
                if self.is_route_profitable(&route_2hop, pools) {
                    new_routes.push(route_2hop);
                }

                // 3-hop route
                for (k, pool3) in pools.iter().enumerate().skip(j + 1) {
                    let route_3hop = Route {
                        id: format!("route_{}_{}_{}",i, j, k),
                        path: vec![
                            pool1.address.clone(),
                            pool2.address.clone(),
                            pool3.address.clone(),
                        ],
                        tokens: vec![
                            pool1.token0.clone(),
                            pool1.token1.clone(),
                            pool2.token1.clone(),
                            pool3.token1.clone(),
                        ],
                        hops: 3,
                    };

                    if self.is_route_profitable(&route_3hop, pools) {
                        new_routes.push(route_3hop);
                    }
                }
            }
        }

        // Deposit pheromones for discovered routes
        for route in &new_routes {
            let _ = self
                .pheromone_layer
                .deposit_profitable_route(route.id.clone(), self.id.clone(), 0.9)
                .await;

            self.metrics.routes_discovered += 1;
        }

        let latency = start.elapsed().as_micros() as u64;
        self.latency_tracker.record(latency);
        self.metrics.average_latency_us = self.latency_tracker.average();
        self.metrics.p99_latency_us = self.latency_tracker.p99();

        self.discovered_routes.extend(new_routes.clone());
        new_routes
    }

    /// Check if a route is profitable (simplified)
    fn is_route_profitable(&self, route: &Route, _pools: &[PoolState]) -> bool {
        // Simplified: routes with 2-3 hops have ~40% chance of being profitable
        // In production, would calculate actual profit from pool reserves
        route.hops >= 2 && route.hops <= 3
    }

    /// Scout responds to pheromones from other scouts
    /// If a route is marked as unprofitable, scout stops exploring it
    pub async fn respond_to_pheromone(&mut self, pheromone: &Pheromone) {
        match pheromone.signal_type {
            SignalType::ProfitableRoute => {
                // Another scout found a profitable route
                // This scout will prioritize exploring similar routes
                // (Emergent behavior: collective learning)
            }
            SignalType::UnprofitableRoute => {
                // Route is no longer profitable, remove from exploration
                self.discovered_routes
                    .retain(|r| r.id != pheromone.route_id);
            }
            SignalType::DangerZone => {
                // Danger detected on this route, avoid it
                self.discovered_routes
                    .retain(|r| r.id != pheromone.route_id);
            }
            _ => {}
        }
    }

    /// Get scout metrics
    pub fn get_metrics(&self) -> WorkerMetrics {
        self.metrics.clone()
    }
}

#[async_trait::async_trait]
impl StigmergicWorker for Scout {
    async fn on_pheromone(&self, pheromone: &Pheromone) {
        // Scouts read pheromones to understand the environment
        // This is how they collectively learn about profitable routes
    }

    async fn update_from_environment(&self, pheromone_layer: &PheromoneLayer) {
        // Scout checks active routes and their intensities
        let active_routes = pheromone_layer.get_active_routes();
        
        // Prioritize exploring routes with high pheromone intensity
        for route_id in active_routes {
            let intensity = pheromone_layer.get_route_intensity(&route_id);
            if intensity > 0.7 {
                // High intensity = many scouts found this route profitable
                // This scout should explore similar patterns
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_scout_route_discovery() {
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
        let mut scout = Scout::new("scout_1".to_string(), pheromone_layer);

        let pools = vec![
            PoolState {
                address: "0x1".to_string(),
                token0: "USDC".to_string(),
                token1: "WETH".to_string(),
                reserve0: 1000000000000,
                reserve1: 500000000000000000000,
                fee: 3000,
                updated_at: chrono::Utc::now(),
            },
            PoolState {
                address: "0x2".to_string(),
                token0: "WETH".to_string(),
                token1: "DAI".to_string(),
                reserve0: 500000000000000000000,
                reserve1: 1000000000000000000000,
                fee: 3000,
                updated_at: chrono::Utc::now(),
            },
        ];

        let routes = scout.explore_routes(&pools).await;
        assert!(!routes.is_empty());
        assert!(scout.metrics.routes_discovered > 0);
    }
}
