/// Integration tests for the supercolony system
/// Tests all components working together

#[cfg(test)]
mod tests {
    use crate::types::*;
    use crate::pheromone_advanced::AdvancedPheromoneLayer;
    use crate::signal_propagation::SignalPropagation;
    use crate::collective_learning::CollectiveLearning;
    use crate::capital_allocator::CapitalAllocator;
    use crate::profit_manager::ProfitManager;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_full_cycle_pheromone_to_execution() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x1234".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let pheromone_layer = Arc::new(AdvancedPheromoneLayer::new(config.clone()));
        let capital_allocator = Arc::new(CapitalAllocator::new(1000000));
        let profit_manager = Arc::new(ProfitManager::new("0x1234".to_string(), 0.8));

        // Scout deposits pheromone
        pheromone_layer.deposit("route_1".to_string(), "scout_1".to_string(), 0.8).await;

        // Executor reads pheromone
        let intensity = pheromone_layer.get_intensity("route_1");
        assert_eq!(intensity, 0.8);

        // Capital allocator allocates based on pheromone
        capital_allocator.allocate_by_pheromone("executor_1".to_string(), intensity).ok();

        // Verify allocation
        let allocation = capital_allocator.get_allocation("executor_1");
        assert!(allocation.is_some());

        // Profit manager tracks profit
        profit_manager.record_trade_profit("executor_1".to_string(), 5000);

        // Verify profit
        let total_profit = profit_manager.get_total_profit();
        assert_eq!(total_profit, 5000);
    }

    #[tokio::test]
    async fn test_pheromone_decay_and_evaporation() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 1, // Very short TTL for testing
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let pheromone_layer = Arc::new(AdvancedPheromoneLayer::new(config));

        // Deposit pheromone
        pheromone_layer.deposit("route_1".to_string(), "scout_1".to_string(), 1.0).await;

        // Verify it exists
        let intensity_before = pheromone_layer.get_intensity("route_1");
        assert_eq!(intensity_before, 1.0);

        // Decay
        pheromone_layer.decay();
        let intensity_after_decay = pheromone_layer.get_intensity("route_1");
        assert!(intensity_after_decay < 1.0);

        // Wait for evaporation
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Evaporate
        pheromone_layer.evaporate();
        let intensity_after_evaporation = pheromone_layer.get_intensity("route_1");
        assert_eq!(intensity_after_evaporation, 0.0);
    }

    #[tokio::test]
    async fn test_signal_propagation_and_learning() {
        let signal_propagation = Arc::new(SignalPropagation::new());
        let collective_learning = Arc::new(CollectiveLearning::new());

        // Broadcast profitable route
        signal_propagation.broadcast_profitable_route("route_1".to_string(), 0.8).ok();

        // Record learning
        collective_learning.discover_pattern(
            "pattern_1".to_string(),
            "High profit routes".to_string(),
            vec!["scout_1".to_string()],
        );

        // Verify learning
        let patterns = collective_learning.get_patterns();
        assert_eq!(patterns.len(), 1);

        // Get signal history
        let history = signal_propagation.get_history("profitable_route");
        assert_eq!(history.len(), 1);
    }

    #[tokio::test]
    async fn test_capital_rebalancing_based_on_performance() {
        let capital_allocator = Arc::new(CapitalAllocator::new(1000000));

        // Initial allocations
        capital_allocator.allocate("executor_1".to_string(), 300000).ok();
        capital_allocator.allocate("executor_2".to_string(), 300000).ok();
        capital_allocator.allocate("executor_3".to_string(), 400000).ok();

        // Rebalance based on performance
        let performance_data = vec![
            ("executor_1".to_string(), 0.9), // 90% success
            ("executor_2".to_string(), 0.5), // 50% success
            ("executor_3".to_string(), 0.1), // 10% success
        ];

        capital_allocator.rebalance(performance_data).ok();

        // Verify rebalance
        let stats = capital_allocator.get_statistics();
        assert_eq!(stats.worker_count, 3);

        // Best performer should have more capital
        let executor_1_allocation = capital_allocator.get_allocation("executor_1");
        let executor_3_allocation = capital_allocator.get_allocation("executor_3");
        assert!(executor_1_allocation.unwrap() > executor_3_allocation.unwrap());
    }

    #[tokio::test]
    async fn test_profit_reinvestment_and_withdrawal() {
        let profit_manager = Arc::new(ProfitManager::new("0x1234".to_string(), 0.8));

        // Record profits
        profit_manager.record_trade_profit("executor_1".to_string(), 10000);
        profit_manager.record_trade_profit("executor_2".to_string(), 5000);

        // Total profit should be 15000
        let total_profit = profit_manager.get_total_profit();
        assert_eq!(total_profit, 15000);

        // Calculate reinvestment and withdrawal
        let reinvestment = profit_manager.calculate_reinvestment();
        let withdrawal = profit_manager.calculate_withdrawal();

        assert_eq!(reinvestment, 12000); // 80% of 15000
        assert_eq!(withdrawal, 3000); // 20% of 15000

        // Reinvest
        profit_manager.reinvest(reinvestment).ok();

        // Verify reinvestment
        let remaining_profit = profit_manager.get_total_profit();
        assert_eq!(remaining_profit, 3000);

        // Withdraw
        profit_manager.withdraw(withdrawal).ok();

        // Verify withdrawal
        let final_profit = profit_manager.get_total_profit();
        assert_eq!(final_profit, 0);
    }

    #[tokio::test]
    async fn test_danger_zone_avoidance() {
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

        // Deposit profitable route
        pheromone_layer.deposit("route_1".to_string(), "scout_1".to_string(), 0.8).await;

        // Deposit danger signal
        pheromone_layer.deposit_danger("route_1".to_string(), "scout_2".to_string()).await;

        // Check danger zones
        let danger_zones = pheromone_layer.get_danger_zones();
        assert!(danger_zones.contains(&"route_1".to_string()));

        // Active routes should not include danger zones
        let active_routes = pheromone_layer.get_active_routes();
        assert!(!active_routes.contains(&"route_1".to_string()));
    }

    #[tokio::test]
    async fn test_collective_intelligence_scoring() {
        let collective_learning = Arc::new(CollectiveLearning::new());

        // Record route performance
        for i in 0..5 {
            collective_learning.record_route_performance(
                format!("route_{}", i),
                true,
                1000 * (i as i128 + 1),
            );
        }

        // Record worker performance
        for i in 0..3 {
            collective_learning.record_worker_performance(
                format!("worker_{}", i),
                0.8 + (i as f64 * 0.05),
                5000,
                0.5,
            );
        }

        // Discover patterns
        for i in 0..2 {
            collective_learning.discover_pattern(
                format!("pattern_{}", i),
                "Discovered pattern".to_string(),
                vec![format!("scout_{}", i)],
            );
        }

        // Get intelligence score
        let score = collective_learning.calculate_intelligence_score();
        assert!(score > 0.0);

        // Get statistics
        let stats = collective_learning.get_statistics();
        assert_eq!(stats.total_routes, 5);
        assert_eq!(stats.total_workers, 3);
        assert_eq!(stats.total_patterns, 2);
    }

    #[tokio::test]
    async fn test_end_to_end_supercolony_cycle() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x1234".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let pheromone_layer = Arc::new(AdvancedPheromoneLayer::new(config.clone()));
        let signal_propagation = Arc::new(SignalPropagation::new());
        let collective_learning = Arc::new(CollectiveLearning::new());
        let capital_allocator = Arc::new(CapitalAllocator::new(1000000));
        let profit_manager = Arc::new(ProfitManager::new("0x1234".to_string(), 0.8));

        // Cycle 1: Scout discovers route
        pheromone_layer.deposit("route_1".to_string(), "scout_1".to_string(), 0.9).await;
        signal_propagation.broadcast_profitable_route("route_1".to_string(), 0.9).ok();
        collective_learning.discover_pattern(
            "pattern_1".to_string(),
            "High profit route".to_string(),
            vec!["scout_1".to_string()],
        );

        // Cycle 2: Executor allocates capital and executes
        capital_allocator.allocate_by_pheromone("executor_1".to_string(), 0.9).ok();
        profit_manager.record_trade_profit("executor_1".to_string(), 5000);

        // Cycle 3: Pheromone decay and rebalancing
        pheromone_layer.decay();
        let performance_data = vec![("executor_1".to_string(), 0.95)];
        capital_allocator.rebalance(performance_data).ok();

        // Verify final state
        let total_profit = profit_manager.get_total_profit();
        assert_eq!(total_profit, 5000);

        let capital_stats = capital_allocator.get_statistics();
        assert!(capital_stats.allocated_capital > 0);

        let pheromone_stats = pheromone_layer.get_stats();
        assert!(pheromone_stats.active_pheromones > 0);

        let learning_stats = collective_learning.get_statistics();
        assert!(learning_stats.total_patterns > 0);
    }
}
