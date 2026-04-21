use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolState {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub reserve0: u128,
    pub reserve1: u128,
    pub fee: u32,
    pub last_update: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageOpportunity {
    pub id: String,
    pub tokens: Vec<String>,
    pub path: Vec<String>,
    pub profit_usd: f64,
    pub profit_percent: f64,
    pub mev_risk_score: f64,
    pub is_safe: bool,
    pub detected_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub opportunity_id: String,
    pub status: TradeStatus,
    pub tokens: Vec<String>,
    pub loan_amount: u128,
    pub estimated_profit: f64,
    pub actual_profit: f64,
    pub gas_cost: f64,
    pub tx_hash: Option<String>,
    pub mev_risk_score: f64,
    pub executed_by: String, // "keeper" or "queen"
    pub created_at: u64,
    pub executed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TradeStatus {
    Pending,
    Submitted,
    Confirmed,
    Failed,
    Reverted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MEVRiskAnalysis {
    pub sandwich_risk: f64,      // 0-100
    pub slippage_risk: f64,      // 0-100
    pub liquidity_risk: f64,     // 0-100
    pub gas_price_risk: f64,     // 0-100
    pub overall_score: f64,      // 0-100 (higher = more risky)
    pub recommendation: String,  // "safe" or "risky"
    pub details: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerConfig {
    pub pools: Vec<String>,
    pub min_profit_usd: f64,
    pub max_slippage_percent: f64,
    pub scan_interval_ms: u64,
    pub loan_amounts: Vec<u128>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeeperConfig {
    pub private_key: String,
    pub contract_address: String,
    pub max_gas_price_gwei: u32,
    pub min_profit_threshold_usd: f64,
    pub max_position_size_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueenConfig {
    pub mev_risk_threshold: f64,  // 0-100, above this = risky
    pub sandwich_risk_threshold: f64,
    pub slippage_risk_threshold: f64,
    pub require_human_approval: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketMessage {
    pub message_type: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardUpdate {
    pub scanner_stats: ScannerStats,
    pub keeper_stats: KeeperStats,
    pub recent_trades: Vec<Trade>,
    pub current_opportunities: Vec<ArbitrageOpportunity>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScannerStats {
    pub total_scans: u64,
    pub opportunities_found: u64,
    pub safe_opportunities: u64,
    pub risky_opportunities: u64,
    pub last_scan_time: u64,
    pub avg_scan_latency_ms: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KeeperStats {
    pub total_trades: u64,
    pub successful_trades: u64,
    pub failed_trades: u64,
    pub total_profit: f64,
    pub total_gas_cost: f64,
    pub last_trade_time: u64,
    pub avg_trade_latency_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub timestamp: u64,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        }
    }

    pub fn err(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        }
    }
}
