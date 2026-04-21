pub mod types;
pub mod scanner;
pub mod keeper;
pub mod queen;
pub mod server;
pub mod utils;
pub mod config;

pub use types::*;
pub use config::Config;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Config,
    pub scanner_stats: std::sync::Arc<tokio::sync::RwLock<ScannerStats>>,
    pub keeper_stats: std::sync::Arc<tokio::sync::RwLock<KeeperStats>>,
    pub trade_history: std::sync::Arc<tokio::sync::RwLock<Vec<Trade>>>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ScannerStats {
    pub total_scans: u64,
    pub opportunities_found: u64,
    pub safe_opportunities: u64,
    pub risky_opportunities: u64,
    pub last_scan_time: u64,
    pub avg_scan_latency_ms: f64,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct KeeperStats {
    pub total_trades: u64,
    pub successful_trades: u64,
    pub failed_trades: u64,
    pub total_profit: f64,
    pub total_gas_cost: f64,
    pub last_trade_time: u64,
    pub avg_trade_latency_ms: f64,
}
