mod types;
mod pheromone;
mod scout;
mod executor;
mod supercolony;
mod alchemy_monitor;
mod route_graph;
mod scout_enhanced;
mod pheromone_advanced;
mod signal_propagation;
mod collective_learning;
mod capital_allocator;
mod executor_advanced;
mod profit_manager;
mod supercolony_orchestrator;
mod integration_tests;
mod benchmarks;

use types::*;
use supercolony::Supercolony;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("🐜 MEV Supercolony - Rust Edition");
    println!("================================\n");

    // Create configuration
    let config = SupercolonyConfig {
        alchemy_key: std::env::var("ALCHEMY_KEY").unwrap_or_else(|_| "test".to_string()),
        private_key: std::env::var("PRIVATE_KEY").unwrap_or_else(|_| "test".to_string()),
        profit_address: std::env::var("PROFIT_ADDRESS").unwrap_or_else(|_| "0x".to_string()),
        initial_capital: 1000000,
        max_workers: 10,
        pheromone_ttl_seconds: 300,
        min_profit_threshold: 1000,
        gas_price_multiplier: 1.0,
    };

    // Create supercolony
    let supercolony = Supercolony::new(config);
    println!("✓ Supercolony initialized");

    // Add workers
    println!("\nAdding workers...");
    supercolony.add_scout("scout_1".to_string()).await?;
    supercolony.add_scout("scout_2".to_string()).await?;
    supercolony.add_executor("executor_1".to_string(), 100000).await?;
    supercolony.add_executor("executor_2".to_string(), 100000).await?;
    println!("✓ 2 scouts + 2 executors added");

    // Simulate pool data
    let pools = vec![
        PoolState {
            address: "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8".to_string(),
            token0: "USDC".to_string(),
            token1: "WETH".to_string(),
            reserve0: 1000000000000,
            reserve1: 500000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        },
        PoolState {
            address: "0x60594a405d53811d3BC4766596EFfb91c56676Fe".to_string(),
            token0: "WETH".to_string(),
            token1: "DAI".to_string(),
            reserve0: 500000000000000000000,
            reserve1: 1000000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        },
        PoolState {
            address: "0xA63b845Ebf2f5Ed8d7Cb4aEA640e3D8a5e2e9D0A".to_string(),
            token0: "USDC".to_string(),
            token1: "DAI".to_string(),
            reserve0: 1000000000000,
            reserve1: 1000000000000000000000,
            fee: 1000,
            updated_at: chrono::Utc::now(),
        },
    ];

    println!("\n🔄 Running supercolony cycles...\n");

    // Run multiple cycles
    for cycle in 1..=5 {
        let cycle_start = Instant::now();
        
        println!("Cycle {}", cycle);
        supercolony.run_cycle(&pools).await?;

        let metrics = supercolony.get_metrics().await;
        let (routes, pheromones) = supercolony.get_pheromone_stats();

        println!(
            "  Routes: {} | Pheromones: {} | Trades: {} | Profit: {} wei | Latency: {:.2}μs",
            routes,
            pheromones,
            metrics.total_trades,
            metrics.total_profit,
            metrics.average_latency_us
        );

        let cycle_latency = cycle_start.elapsed().as_micros();
        println!("  Cycle latency: {:.2}ms\n", cycle_latency as f64 / 1000.0);

        // Sleep between cycles
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    // Final metrics
    println!("\n📊 Final Metrics");
    println!("================");
    let metrics = supercolony.get_metrics().await;
    println!("Total opportunities: {}", metrics.total_opportunities);
    println!("Total trades: {}", metrics.total_trades);
    println!("Successful trades: {}", metrics.successful_trades);
    println!("Failed trades: {}", metrics.failed_trades);
    println!("Total profit: {} wei", metrics.total_profit);
    println!("Average latency: {:.2}μs", metrics.average_latency_us);
    println!("P99 latency: {:.2}μs", metrics.p99_latency_us);
    println!("P99.9 latency: {:.2}μs", metrics.p99_9_latency_us);
    println!("Active workers: {}", metrics.active_workers);
    println!("Active routes: {}", metrics.active_routes);
    println!("Capital allocated: {} wei", metrics.capital_allocated);
    println!("Capital available: {} wei", metrics.capital_available);

    println!("\n✓ Supercolony completed successfully!");

    Ok(())
}
