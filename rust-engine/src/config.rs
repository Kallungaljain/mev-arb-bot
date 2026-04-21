use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    // Blockchain
    pub rpc_url: String,
    pub private_key: String,
    pub contract_address: String,
    pub network: String, // "polygon" or "mumbai"

    // Scanner
    pub scanner_interval_ms: u64,
    pub min_profit_usd: f64,
    pub max_slippage_percent: f64,
    pub loan_amounts: Vec<u128>,

    // Keeper
    pub max_gas_price_gwei: u32,
    pub min_profit_threshold_usd: f64,
    pub max_position_size_usd: f64,

    // Queen (MEV Risk Analyzer)
    pub mev_risk_threshold: f64,
    pub sandwich_risk_threshold: f64,
    pub slippage_risk_threshold: f64,
    pub require_human_approval: bool,

    // Server
    pub server_host: String,
    pub server_port: u16,
    pub websocket_port: u16,

    // Logging
    pub log_level: String,
}

impl Config {
    pub fn from_env() -> Self {
        dotenv::dotenv().ok();

        Config {
            rpc_url: env::var("RPC_URL")
                .unwrap_or_else(|_| "https://polygon-rpc.com".to_string()),
            private_key: env::var("PRIVATE_KEY")
                .expect("PRIVATE_KEY environment variable not set"),
            contract_address: env::var("CONTRACT_ADDRESS")
                .expect("CONTRACT_ADDRESS environment variable not set"),
            network: env::var("NETWORK")
                .unwrap_or_else(|_| "polygon".to_string()),

            scanner_interval_ms: env::var("SCANNER_INTERVAL_MS")
                .unwrap_or_else(|_| "1000".to_string())
                .parse()
                .unwrap_or(1000),
            min_profit_usd: env::var("MIN_PROFIT_USD")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .unwrap_or(5.0),
            max_slippage_percent: env::var("MAX_SLIPPAGE_PERCENT")
                .unwrap_or_else(|_| "0.5".to_string())
                .parse()
                .unwrap_or(0.5),
            loan_amounts: vec![
                1_000_000_000_000_000_000,  // 1 USDC
                10_000_000_000_000_000_000, // 10 USDC
                100_000_000_000_000_000_000, // 100 USDC
            ],

            max_gas_price_gwei: env::var("MAX_GAS_PRICE_GWEI")
                .unwrap_or_else(|_| "100".to_string())
                .parse()
                .unwrap_or(100),
            min_profit_threshold_usd: env::var("MIN_PROFIT_THRESHOLD_USD")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .unwrap_or(5.0),
            max_position_size_usd: env::var("MAX_POSITION_SIZE_USD")
                .unwrap_or_else(|_| "10000".to_string())
                .parse()
                .unwrap_or(10000.0),

            mev_risk_threshold: env::var("MEV_RISK_THRESHOLD")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .unwrap_or(60.0),
            sandwich_risk_threshold: env::var("SANDWICH_RISK_THRESHOLD")
                .unwrap_or_else(|_| "50".to_string())
                .parse()
                .unwrap_or(50.0),
            slippage_risk_threshold: env::var("SLIPPAGE_RISK_THRESHOLD")
                .unwrap_or_else(|_| "1.0".to_string())
                .parse()
                .unwrap_or(1.0),
            require_human_approval: env::var("REQUIRE_HUMAN_APPROVAL")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),

            server_host: env::var("SERVER_HOST")
                .unwrap_or_else(|_| "0.0.0.0".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3000".to_string())
                .parse()
                .unwrap_or(3000),
            websocket_port: env::var("WEBSOCKET_PORT")
                .unwrap_or_else(|_| "3001".to_string())
                .parse()
                .unwrap_or(3001),

            log_level: env::var("LOG_LEVEL")
                .unwrap_or_else(|_| "info".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = Config {
            rpc_url: "https://polygon-rpc.com".to_string(),
            private_key: "0x123".to_string(),
            contract_address: "0x456".to_string(),
            network: "polygon".to_string(),
            scanner_interval_ms: 1000,
            min_profit_usd: 5.0,
            max_slippage_percent: 0.5,
            loan_amounts: vec![1_000_000_000_000_000_000],
            max_gas_price_gwei: 100,
            min_profit_threshold_usd: 5.0,
            max_position_size_usd: 10000.0,
            mev_risk_threshold: 60.0,
            sandwich_risk_threshold: 50.0,
            slippage_risk_threshold: 1.0,
            require_human_approval: false,
            server_host: "0.0.0.0".to_string(),
            server_port: 3000,
            websocket_port: 3001,
            log_level: "info".to_string(),
        };

        assert_eq!(config.min_profit_usd, 5.0);
        assert_eq!(config.max_slippage_percent, 0.5);
    }
}
