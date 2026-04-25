/// Performance benchmarks for the supercolony system

#[cfg(test)]
mod benchmarks {
    use crate::types::*;
    use crate::pheromone_advanced::AdvancedPheromoneLayer;
    use crate::signal_propagation::SignalPropagation;
    use crate::collective_learning::CollectiveLearning;
    use crate::capital_allocator::CapitalAllocator;
    use crate::profit_manager::ProfitManager;
    use std::sync::Arc;
    use instant::Instant;

    #[test]
    fn benchmark_pheromone_deposit() {
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
        let rt = tokio::runtime::Runtime::new().unwrap();

        let start = Instant::now();
        for i in 0..10000 {
            rt.block_on(async {
                pheromone_layer.deposit(
                    format!("route_{}", i),
                    "scout_1".to_string(),
                    0.8,
                ).await;
            });
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 10000.0;
        println!("Pheromone deposit: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 100.0, "Pheromone deposit too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_pheromone_intensity_lookup() {
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
        let rt = tokio::runtime::Runtime::new().unwrap();

        // Pre-populate
        for i in 0..1000 {
            rt.block_on(async {
                pheromone_layer.deposit(
                    format!("route_{}", i),
                    "scout_1".to_string(),
                    0.8,
                ).await;
            });
        }

        let start = Instant::now();
        for i in 0..10000 {
            let _ = pheromone_layer.get_intensity(&format!("route_{}", i % 1000));
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 10000.0;
        println!("Pheromone lookup: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 10.0, "Pheromone lookup too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_signal_broadcast() {
        let signal_propagation = Arc::new(SignalPropagation::new());

        let start = Instant::now();
        for i in 0..10000 {
            let _ = signal_propagation.broadcast_profitable_route(
                format!("route_{}", i),
                0.8,
            );
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 10000.0;
        println!("Signal broadcast: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 50.0, "Signal broadcast too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_capital_allocation() {
        let capital_allocator = Arc::new(CapitalAllocator::new(1000000000));

        let start = Instant::now();
        for i in 0..1000 {
            let _ = capital_allocator.allocate(
                format!("executor_{}", i),
                1000000,
            );
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 1000.0;
        println!("Capital allocation: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 100.0, "Capital allocation too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_profit_tracking() {
        let profit_manager = Arc::new(ProfitManager::new("0x1234".to_string(), 0.8));

        let start = Instant::now();
        for i in 0..10000 {
            profit_manager.record_trade_profit(
                format!("executor_{}", i % 100),
                1000,
            );
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 10000.0;
        println!("Profit tracking: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 50.0, "Profit tracking too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_collective_learning() {
        let collective_learning = Arc::new(CollectiveLearning::new());

        let start = Instant::now();
        for i in 0..10000 {
            collective_learning.record_route_performance(
                format!("route_{}", i % 1000),
                i % 2 == 0,
                1000,
            );
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 10000.0;
        println!("Collective learning: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 50.0, "Collective learning too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_full_cycle() {
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
        let rt = tokio::runtime::Runtime::new().unwrap();

        let start = Instant::now();
        for i in 0..1000 {
            // Scout deposits
            rt.block_on(async {
                pheromone_layer.deposit(
                    format!("route_{}", i % 100),
                    "scout_1".to_string(),
                    0.8,
                ).await;
            });

            // Executor allocates
            let _ = capital_allocator.allocate(
                format!("executor_{}", i % 10),
                1000,
            );

            // Profit tracking
            profit_manager.record_trade_profit(
                format!("executor_{}", i % 10),
                100,
            );

            // Pheromone decay
            pheromone_layer.decay();
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 1000.0;
        println!("Full cycle: {:.2}μs per operation", avg_latency);
        println!("Expected latency: <5000μs (5ms)");
        assert!(avg_latency < 5000.0, "Full cycle too slow: {:.2}μs", avg_latency);
    }

    #[test]
    fn benchmark_pheromone_decay() {
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
        let rt = tokio::runtime::Runtime::new().unwrap();

        // Pre-populate
        for i in 0..1000 {
            rt.block_on(async {
                pheromone_layer.deposit(
                    format!("route_{}", i),
                    "scout_1".to_string(),
                    0.8,
                ).await;
            });
        }

        let start = Instant::now();
        for _ in 0..100 {
            pheromone_layer.decay();
        }
        let elapsed = start.elapsed();

        let avg_latency = elapsed.as_micros() as f64 / 100.0;
        println!("Pheromone decay: {:.2}μs per operation", avg_latency);
        assert!(avg_latency < 1000.0, "Pheromone decay too slow: {:.2}μs", avg_latency);
    }
}
