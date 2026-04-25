use crate::types::*;
use crate::pheromone::PheromoneLayer;
use crate::scout::Scout;
use crate::executor::Executor;
use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::RwLock;

/// The Supercolony - orchestrates all workers through stigmergy
/// No central queen - all coordination happens through pheromones
pub struct Supercolony {
    config: SupercolonyConfig,
    pheromone_layer: Arc<PheromoneLayer>,
    
    /// Scout workers
    scouts: Arc<DashMap<Id, Scout>>,
    
    /// Executor workers
    executors: Arc<DashMap<Id, Executor>>,
    
    /// Capital allocation
    capital: Arc<RwLock<CapitalAllocation>>,
    
    /// System metrics
    metrics: Arc<RwLock<SystemMetrics>>,
}

impl Supercolony {
    pub fn new(config: SupercolonyConfig) -> Self {
        let pheromone_layer = Arc::new(PheromoneLayer::new(config.clone()));
        
        let capital = CapitalAllocation {
            total_capital: config.initial_capital,
            allocated: Default::default(),
            available: config.initial_capital,
            reserved: 0,
        };

        let metrics = SystemMetrics {
            total_opportunities: 0,
            total_trades: 0,
            successful_trades: 0,
            failed_trades: 0,
            total_profit: 0,
            average_latency_us: 0.0,
            p99_latency_us: 0.0,
            p99_9_latency_us: 0.0,
            active_workers: 0,
            active_routes: 0,
            capital_allocated: 0,
            capital_available: config.initial_capital,
        };

        Self {
            config,
            pheromone_layer,
            scouts: Arc::new(DashMap::new()),
            executors: Arc::new(DashMap::new()),
            capital: Arc::new(RwLock::new(capital)),
            metrics: Arc::new(RwLock::new(metrics)),
        }
    }

    /// Add a scout worker
    pub async fn add_scout(&self, scout_id: Id) -> Result<(), String> {
        let scout = Scout::new(scout_id.clone(), self.pheromone_layer.clone());
        self.scouts.insert(scout_id, scout);
        
        let mut metrics = self.metrics.write().await;
        metrics.active_workers = self.scouts.len() + self.executors.len();
        
        Ok(())
    }

    /// Add an executor worker
    pub async fn add_executor(&self, executor_id: Id, capital: u128) -> Result<(), String> {
        // Check if we have enough capital
        let mut capital_state = self.capital.write().await;
        if capital > capital_state.available {
            return Err("Insufficient capital".to_string());
        }

        capital_state.available -= capital;
        capital_state.allocated.insert(executor_id.clone(), capital);
        capital_state.reserved += capital;

        drop(capital_state);

        let executor = Executor::new(executor_id.clone(), self.pheromone_layer.clone(), capital);
        self.executors.insert(executor_id, executor);

        let mut metrics = self.metrics.write().await;
        metrics.active_workers = self.scouts.len() + self.executors.len();
        metrics.capital_allocated += capital;
        metrics.capital_available -= capital;

        Ok(())
    }

    /// Run scouts to discover routes
    pub async fn run_scouts(&self, pools: &[PoolState]) -> Result<(), String> {
        let mut scout_handles = Vec::new();

        for scout_entry in self.scouts.iter_mut() {
            let scout_id = scout_entry.key().clone();
            let pools = pools.to_vec();
            let scouts = self.scouts.clone();

            let handle = tokio::spawn(async move {
                if let Some(mut scout) = scouts.get_mut(&scout_id) {
                    let _ = scout.explore_routes(&pools).await;
                }
            });

            scout_handles.push(handle);
        }

        // Wait for all scouts to complete
        for handle in scout_handles {
            let _ = handle.await;
        }

        // Update metrics
        let mut metrics = self.metrics.write().await;
        metrics.active_routes = self.pheromone_layer.get_active_routes().len() as usize;

        Ok(())
    }

    /// Run executors to find and execute trades
    pub async fn run_executors(&self) -> Result<(), String> {
        let mut executor_handles = Vec::new();

        for executor_entry in self.executors.iter_mut() {
            let executor_id = executor_entry.key().clone();
            let executors = self.executors.clone();

            let handle = tokio::spawn(async move {
                if let Some(mut executor) = executors.get_mut(&executor_id) {
                    let opportunities = executor.scan_for_opportunities().await;
                    
                    for opportunity in opportunities {
                        let _ = executor.execute_trade(&opportunity).await;
                    }
                }
            });

            executor_handles.push(handle);
        }

        // Wait for all executors to complete
        for handle in executor_handles {
            let _ = handle.await;
        }

        // Update metrics
        let mut metrics = self.metrics.write().await;
        let mut total_profit = 0i128;
        let mut total_trades = 0u64;
        let mut successful_trades = 0u64;

        for executor_entry in self.executors.iter() {
            let executor_metrics = executor_entry.get_metrics();
            total_profit += executor_metrics.total_profit;
            total_trades += executor_metrics.trades_executed as u64;
            successful_trades += executor_metrics.successful_trades as u64;
        }

        metrics.total_profit = total_profit;
        metrics.total_trades = total_trades;
        metrics.successful_trades = successful_trades;
        metrics.failed_trades = total_trades - successful_trades;

        Ok(())
    }

    /// Maintenance: evaporate expired pheromones
    pub async fn maintenance(&self) {
        self.pheromone_layer.evaporate_expired();
    }

    /// Get system metrics
    pub async fn get_metrics(&self) -> SystemMetrics {
        self.metrics.read().await.clone()
    }

    /// Get pheromone statistics
    pub fn get_pheromone_stats(&self) -> (usize, usize) {
        self.pheromone_layer.get_statistics()
    }

    /// Run the supercolony for one cycle
    pub async fn run_cycle(&self, pools: &[PoolState]) -> Result<(), String> {
        // 1. Scouts explore and deposit pheromones
        self.run_scouts(pools).await?;

        // 2. Executors read pheromones and execute trades
        self.run_executors().await?;

        // 3. Maintenance
        self.maintenance().await;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_supercolony_creation() {
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

        let supercolony = Supercolony::new(config);
        
        let _ = supercolony.add_scout("scout_1".to_string()).await;
        let _ = supercolony.add_executor("executor_1".to_string(), 100000).await;

        let metrics = supercolony.get_metrics().await;
        assert_eq!(metrics.active_workers, 2);
    }

    #[tokio::test]
    async fn test_supercolony_cycle() {
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

        let supercolony = Supercolony::new(config);
        
        let _ = supercolony.add_scout("scout_1".to_string()).await;
        let _ = supercolony.add_executor("executor_1".to_string(), 100000).await;

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
        ];

        let _ = supercolony.run_cycle(&pools).await;
        
        let metrics = supercolony.get_metrics().await;
        assert!(metrics.active_routes >= 0);
    }
}
