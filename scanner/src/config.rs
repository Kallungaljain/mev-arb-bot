use anyhow::{Context, Result};
use dotenvy::dotenv;

#[derive(Debug, Clone)]
pub struct Config {
    pub alchemy_api_key: String,
    pub keeper_url: String,
    pub keeper_secret: String,
    pub metrics_port: u16,
    /// Minimum net profit in USD cents to forward to Keeper (e.g. 50 = $0.50)
    pub min_profit_usd_cents: u64,
    /// Maximum acceptable slippage in basis points (e.g. 50 = 0.5%)
    pub max_slippage_bps: u64,
    /// Maximum gas price in Gwei to consider a trade
    pub max_gas_gwei: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let _ = dotenv(); // ignore error if .env missing

        Ok(Self {
            alchemy_api_key: std::env::var("ALCHEMY_API_KEY")
                .context("ALCHEMY_API_KEY not set")?,
            keeper_url: std::env::var("KEEPER_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:3001".to_string()),
            keeper_secret: std::env::var("KEEPER_SECRET")
                .unwrap_or_else(|_| "change-me-in-production".to_string()),
            metrics_port: std::env::var("METRICS_PORT")
                .unwrap_or_else(|_| "9090".to_string())
                .parse()
                .unwrap_or(9090),
            min_profit_usd_cents: std::env::var("MIN_PROFIT_USD_CENTS")
                .unwrap_or_else(|_| "50".to_string())
                .parse()
                .unwrap_or(50),
            max_slippage_bps: std::env::var("MAX_SLIPPAGE_BPS")
                .unwrap_or_else(|_| "50".to_string())
                .parse()
                .unwrap_or(50),
            max_gas_gwei: std::env::var("MAX_GAS_GWEI")
                .unwrap_or_else(|_| "200".to_string())
                .parse()
                .unwrap_or(200),
        })
    }

    pub fn alchemy_ws_url(&self) -> String {
        format!(
            "wss://polygon-mainnet.g.alchemy.com/v2/{}",
            self.alchemy_api_key
        )
    }

    pub fn alchemy_ws_url_masked(&self) -> String {
        let key = &self.alchemy_api_key;
        let masked = if key.len() > 8 {
            format!("{}...{}", &key[..4], &key[key.len()-4..])
        } else {
            "****".to_string()
        };
        format!("wss://polygon-mainnet.g.alchemy.com/v2/{}", masked)
    }
}
