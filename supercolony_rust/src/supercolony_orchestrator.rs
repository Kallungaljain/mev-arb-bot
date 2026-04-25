use crate::types::*;
use crate::alchemy_monitor::AlchemyMonitor;
use crate::route_graph::RouteGraph;
use crate::scout_enhanced::EnhancedScout;
use crate::executor_advanced::AdvancedExecutor;
use crate::pheromone_advanced::AdvancedPheromoneLayer;
use crate::signal_propagation::SignalPropagation;
use crate::collective_learning::CollectiveLearning;
use crate::capital_allocator::CapitalAllocator;
use crate::profit_manager::ProfitManager;
use std::sync::Arc;
use tokio::task::JoinHandle;
use std::time::Instant;

/// The main orchestrator that brings all components together
pub struct SupercolonyOrchestrator {
    /// Configuration
    config: SupercolonyConfig,
    
    /// Core components
    alchemy_monitor: Arc<AlchemyMonitor>,
    route_graph: Arc<RouteGraph>,
    pheromone_layer: Arc<AdvancedPheromoneLayer>,
    signal_propagation: Arc<SignalPropagation>,
    collective_learning: Arc<CollectiveLearning>,
    capital_allocator: Arc<CapitalAllocator>,
    profit_manager: Arc<ProfitManager>,
    
    /// Workers
    scouts: Vec<EnhancedScout>,
    executors: Vec<AdvancedExecutor>,
    
    /// System metrics
    metrics: SystemMetrics,
    
    /// Running tasks
    tasks: Vec<JoinHandle<()>>,
}

impl SupercolonyOrchestrator {
    pub fn new(config: SupercolonyConfig) -> Self {
        let pheromone_layer = Arc::new(AdvancedPheromoneLayer::new(config.clone()));
        let signal_propagation = Arc::new(SignalPropagation::new());
        let collective_learning = Arc::new(CollectiveLearning::new());
        let capital_allocator = Arc::new(CapitalAllocator::new(config.initial_capital as u128));
        let profit_manager = Arc::new(ProfitManager::new(
            config.profit_address.clone(),
            0.8, // 80% reinvestment rate
        ));

        Self {
            config: config.clone(),
            alchemy_monitor: Arc::new(AlchemyMonitor::new(config.alchemy_key.clone())),
            route_graph: Arc::new(RouteGraph::new()),
            pheromone_layer,
            signal_propagation,
            collective_learning,
            capital_allocator,
            profit_manager,
            scouts: Vec::new(),
            executors: Vec::new(),
            metrics: SystemMetrics::default(),
            tasks: Vec::new(),
        }
    }

    /// Initialize the supercolony with workers
    pub async fn initialize(&mut self) -> Result<(), String> {
        // Create scouts
        for i in 0..3 {
            let scout = EnhancedScout::new(
                format!("scout_{}", i),
                self.route_graph.clone(),
                self.pheromone_layer.clone(),
                self.signal_propagation.clone(),
            );
            self.scouts.push(scout);
        }

        // Create executors
        for i in 0..5 {
            let executor = AdvancedExecutor::new(
                format!("executor_{}", i),
                self.pheromone_layer.clone(),
                self.capital_allocator.clone(),
            );
            self.executors.push(executor);

            // Allocate initial capital
            let allocation = (self.config.initial_capital as u128 / self.config.max_workers as u128) as u128;
            self.capital_allocator.allocate(format!("executor_{}", i), allocation)?;
        }

        Ok(())
    }

    /// Start the supercolony
    pub async fn start(&mut self) -> Result<(), String> {
        // Start Alchemy monitor
        self.alchemy_monitor.start().await?;

        // Start main loop
        let orchestrator_task = self.run_main_loop();
        self.tasks.push(orchestrator_task);

        Ok(())
    }

    /// Main loop - coordinates scouts and executors
    fn run_main_loop(&self) -> JoinHandle<()> {
        let pheromone_layer = self.pheromone_layer.clone();
        let signal_propagation = self.signal_propagation.clone();
        let collective_learning = self.collective_learning.clone();
        let capital_allocator = self.capital_allocator.clone();
        let profit_manager = self.profit_manager.clone();

        tokio::spawn(async move {
            let mut cycle = 0u64;

            loop {
                let start = Instant::now();

                // Phase 1: Scouts explore routes
                // Phase 2: Executors scan opportunities
                // Phase 3: Executors execute trades
                // Phase 4: Update pheromones
                // Phase 5: Rebalance capital
                // Phase 6: Collect learning

                // Evaporate and decay pheromones
                pheromone_layer.evaporate();
                pheromone_layer.decay();

                // Get statistics
                let stats = pheromone_layer.get_stats();
                let capital_stats = capital_allocator.get_statistics();
                let profit_stats = profit_manager.get_statistics();

                // Log cycle
                if cycle % 100 == 0 {
                    println!(
                        "[Cycle {}] Pheromones: {}, Capital allocated: {}, Profit: {}",
                        cycle,
                        stats.active_pheromones,
                        capital_stats.allocated_capital,
                        profit_stats.total_profit
                    );
                }

                let latency = start.elapsed().as_millis();
                if latency > 10 {
                    println!("[Warning] Cycle {} took {}ms (target: <5ms)", cycle, latency);
                }

                cycle += 1;
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        })
    }

    /// Get system metrics
    pub fn get_metrics(&self) -> SystemMetrics {
        self.metrics.clone()
    }

    /// Get pheromone statistics
    pub fn get_pheromone_stats(&self) -> String {
        let stats = self.pheromone_layer.get_stats();
        format!(
            "Active pheromones: {}, Avg intensity: {:.2}, Max intensity: {:.2}",
            stats.active_pheromones, stats.avg_intensity, stats.max_intensity
        )
    }

    /// Get capital statistics
    pub fn get_capital_stats(&self) -> String {
        let stats = self.capital_allocator.get_statistics();
        format!(
            "Total: {}, Allocated: {} ({}%), Available: {}, Workers: {}",
            stats.total_capital,
            stats.allocated_capital,
            stats.allocation_percentage as u64,
            stats.available_capital,
            stats.worker_count
        )
    }

    /// Get profit statistics
    pub fn get_profit_stats(&self) -> String {
        let stats = self.profit_manager.get_statistics();
        format!(
            "Total profit: {}, Trades: {}, Avg per trade: {}, Reinvestment rate: {}%",
            stats.total_profit,
            stats.trade_count,
            stats.average_profit_per_trade,
            (stats.reinvestment_rate * 100.0) as u64
        )
    }

    /// Get system status
    pub fn get_status(&self) -> SupercolonyStatus {
        SupercolonyStatus {
            scouts_count: self.scouts.len(),
            executors_count: self.executors.len(),
            pheromones_active: self.pheromone_layer.get_stats().active_pheromones,
            capital_allocated: self.capital_allocator.get_statistics().allocated_capital,
            total_profit: self.profit_manager.get_statistics().total_profit,
            trades_executed: self.profit_manager.get_statistics().trade_count,
            timestamp: chrono::Utc::now(),
        }
    }

    /// Shutdown the supercolony
    pub async fn shutdown(&mut self) -> Result<(), String> {
        // Stop Alchemy monitor
        self.alchemy_monitor.stop().await?;

        // Cancel all tasks
        for task in &self.tasks {
            task.abort();
        }

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct SupercolonyStatus {
    pub scouts_count: usize,
    pub executors_count: usize,
    pub pheromones_active: usize,
    pub capital_allocated: u128,
    pub total_profit: i128,
    pub trades_executed: u64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_orchestrator_initialization() {
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

        let mut orchestrator = SupercolonyOrchestrator::new(config);
        let result = orchestrator.initialize().await;
        assert!(result.is_ok());
        assert_eq!(orchestrator.scouts.len(), 3);
        assert_eq!(orchestrator.executors.len(), 5);
    }

    #[test]
    fn test_orchestrator_status() {
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

        let orchestrator = SupercolonyOrchestrator::new(config);
        let status = orchestrator.get_status();
        assert_eq!(status.scouts_count, 0);
        assert_eq!(status.executors_count, 0);
    }
}
