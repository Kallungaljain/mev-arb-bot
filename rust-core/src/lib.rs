/// MEV Arbitrage Engine - Ultra-low latency Rust core
/// 
/// Modules:
/// - scanner: Real-time pool monitoring (<10ms)
/// - bellman_ford: Arbitrage detection (<5ms)
/// - profit_simulator: Trade validation (<5ms)
/// - queen: MEV risk analysis (<5ms)
/// - keeper: Trade execution (<50ms)
/// - calldata_encoder: Transaction building (<2ms)

pub mod bellman_ford;
pub mod calldata_encoder;
pub mod keeper;
pub mod profit_simulator;
pub mod queen;
pub mod scanner;

// Re-export main types
pub use bellman_ford::{ArbitragePath, BellmanFordDetector};
pub use calldata_encoder::CalldataEncoder;
pub use keeper::{ExecutionMetrics, Keeper, Trade, TradeStatus};
pub use profit_simulator::{ProfitSimulator, TradeSimulation};
pub use queen::{MEVRiskAnalysis, Queen};
pub use scanner::{ArbitrageOpportunity, Scanner, ScannerMetrics};

/// Engine configuration
#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub min_profit_usd: f64,
    pub max_slippage_pct: f64,
    pub max_gas_price_gwei: f64,
    pub min_liquidity_usd: f64,
    pub scan_interval_ms: u64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            min_profit_usd: 10.0,
            max_slippage_pct: 2.0,
            max_gas_price_gwei: 100.0,
            min_liquidity_usd: 50_000.0,
            scan_interval_ms: 500, // Scan every 500ms
        }
    }
}

/// Main MEV engine orchestrator
pub struct MEVEngine {
    pub scanner: Scanner,
    pub keeper: Keeper,
    pub config: EngineConfig,
}

impl MEVEngine {
    pub fn new(config: EngineConfig) -> Self {
        Self {
            scanner: Scanner::new(),
            keeper: Keeper::new(),
            config,
        }
    }

    pub fn with_defaults() -> Self {
        Self::new(EngineConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_creation() {
        let engine = MEVEngine::with_defaults();
        assert_eq!(engine.config.min_profit_usd, 10.0);
    }
}
