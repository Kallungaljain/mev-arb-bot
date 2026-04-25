use std::env;
use std::sync::Arc;
use tokio::signal;
use log::{info, error, warn};

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

use types::*;
use supercolony_orchestrator::SupercolonyOrchestrator;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    info!("🚀 MEV Supercolony Starting...");

    // Load configuration from environment
    let config = load_config()?;
    
    info!("✅ Configuration loaded:");
    info!("   Initial capital: {}", config.initial_capital);
    info!("   Max workers: {}", config.max_workers);
    info!("   Pheromone TTL: {}s", config.pheromone_ttl_seconds);
    info!("   Min profit threshold: {}", config.min_profit_threshold);

    // Create orchestrator
    let mut orchestrator = SupercolonyOrchestrator::new(config.clone());

    info!("🔧 Initializing supercolony...");
    orchestrator.initialize().await?;
    info!("✅ Supercolony initialized");

    // Print initial status
    let status = orchestrator.get_status();
    info!("📊 Initial status:");
    info!("   Scouts: {}", status.scouts_count);
    info!("   Executors: {}", status.executors_count);
    info!("   Pheromones: {}", status.pheromones_active);
    info!("   Capital allocated: {}", status.capital_allocated);

    // Start the orchestrator
    info!("🚀 Starting supercolony...");
    orchestrator.start().await?;
    info!("✅ Supercolony started");

    // Print system stats
    info!("📈 System Statistics:");
    info!("   {}", orchestrator.get_pheromone_stats());
    info!("   {}", orchestrator.get_capital_stats());
    info!("   {}", orchestrator.get_profit_stats());

    // Setup graceful shutdown
    info!("⏳ Waiting for signals (Ctrl+C to shutdown)...");
    
    let ctrl_c = signal::ctrl_c();
    tokio::pin!(ctrl_c);

    // Main loop
    loop {
        tokio::select! {
            _ = &mut ctrl_c => {
                info!("🛑 Shutdown signal received");
                break;
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {
                // Print stats every minute
                let status = orchestrator.get_status();
                info!("📊 Status Update:");
                info!("   Pheromones: {}", status.pheromones_active);
                info!("   Capital allocated: {}", status.capital_allocated);
                info!("   Total profit: {}", status.total_profit);
                info!("   Trades executed: {}", status.trades_executed);
                info!("   {}", orchestrator.get_pheromone_stats());
                info!("   {}", orchestrator.get_capital_stats());
                info!("   {}", orchestrator.get_profit_stats());
            }
        }
    }

    // Graceful shutdown
    info!("🛑 Shutting down supercolony...");
    orchestrator.shutdown().await?;
    info!("✅ Supercolony shutdown complete");

    info!("👋 MEV Supercolony stopped");
    Ok(())
}

/// Load configuration from environment variables
fn load_config() -> Result<SupercolonyConfig, Box<dyn std::error::Error>> {
    let alchemy_key = env::var("ALCHEMY_API_KEY")
        .map_err(|_| "ALCHEMY_API_KEY not set")?;
    
    let private_key = env::var("PRIVATE_KEY")
        .map_err(|_| "PRIVATE_KEY not set")?;
    
    let profit_address = env::var("PROFIT_ADDRESS")
        .map_err(|_| "PROFIT_ADDRESS not set")?;
    
    let initial_capital = env::var("INITIAL_CAPITAL")
        .unwrap_or_else(|_| "100000000000000000".to_string())
        .parse::<u64>()
        .map_err(|_| "Invalid INITIAL_CAPITAL")?;
    
    let max_workers = env::var("MAX_WORKERS")
        .unwrap_or_else(|_| "10".to_string())
        .parse::<usize>()
        .map_err(|_| "Invalid MAX_WORKERS")?;
    
    let pheromone_ttl_seconds = env::var("PHEROMONE_TTL_SECONDS")
        .unwrap_or_else(|_| "300".to_string())
        .parse::<u64>()
        .map_err(|_| "Invalid PHEROMONE_TTL_SECONDS")?;
    
    let min_profit_threshold = env::var("MIN_PROFIT_THRESHOLD")
        .unwrap_or_else(|_| "1000".to_string())
        .parse::<i128>()
        .map_err(|_| "Invalid MIN_PROFIT_THRESHOLD")?;
    
    let gas_price_multiplier = env::var("GAS_PRICE_MULTIPLIER")
        .unwrap_or_else(|_| "1.0".to_string())
        .parse::<f64>()
        .map_err(|_| "Invalid GAS_PRICE_MULTIPLIER")?;

    Ok(SupercolonyConfig {
        alchemy_key,
        private_key,
        profit_address,
        initial_capital,
        max_workers,
        pheromone_ttl_seconds,
        min_profit_threshold,
        gas_price_multiplier,
    })
}

/// Health check endpoint (for monitoring)
#[cfg(feature = "monitoring")]
async fn health_check_server() {
    use std::net::SocketAddr;
    
    let addr: SocketAddr = "0.0.0.0:9090".parse().unwrap();
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    
    info!("📊 Health check server listening on {}", addr);
    
    loop {
        let (socket, _) = listener.accept().await.unwrap();
        tokio::spawn(async move {
            // Simple health check response
            let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK";
            let _ = socket.try_write_all(response);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_loading() {
        env::set_var("ALCHEMY_API_KEY", "test_key");
        env::set_var("PRIVATE_KEY", "test_key");
        env::set_var("PROFIT_ADDRESS", "0x1234");
        
        let config = load_config().unwrap();
        assert_eq!(config.alchemy_key, "test_key");
        assert_eq!(config.private_key, "test_key");
        assert_eq!(config.profit_address, "0x1234");
    }

    #[test]
    fn test_config_defaults() {
        env::set_var("ALCHEMY_API_KEY", "test_key");
        env::set_var("PRIVATE_KEY", "test_key");
        env::set_var("PROFIT_ADDRESS", "0x1234");
        
        let config = load_config().unwrap();
        assert_eq!(config.initial_capital, 100000000000000000);
        assert_eq!(config.max_workers, 10);
        assert_eq!(config.pheromone_ttl_seconds, 300);
        assert_eq!(config.min_profit_threshold, 1000);
        assert_eq!(config.gas_price_multiplier, 1.0);
    }
}
