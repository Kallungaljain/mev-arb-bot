use anyhow::Result;
use axum::{
    extract::State,
    http::StatusCode,
    routing::get,
    Json, Router,
};
use ethers::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_tungstenite::connect_async;
use tracing::{error, info, warn};
use zmq::Context;

// ============================================================================
// TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolReserves {
    pub address: String,
    pub reserve0: f64,
    pub reserve1: f64,
    pub token0_symbol: String,
    pub token1_symbol: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opportunity {
    pub id: String,
    pub pair: String,
    pub dex_a: String,
    pub dex_b: String,
    pub spread_pct: f64,
    pub token_in: String,
    pub amount_in: f64,
    pub amount_out_dex_a: f64,
    pub amount_out_dex_b: f64,
    pub expected_profit_usd: f64,
    pub confidence: f64,
    pub detected_at: String,
}

#[derive(Debug, Clone)]
pub struct ScannerState {
    pub connected: bool,
    pub pools_subscribed: usize,
    pub opportunities_detected: usize,
    pub last_sync_event: Option<String>,
    pub uptime_seconds: u64,
}

#[derive(Clone)]
pub struct AppState {
    state: Arc<RwLock<ScannerState>>,
    opportunities: Arc<RwLock<Vec<Opportunity>>>,
    pools: Arc<RwLock<std::collections::HashMap<String, PoolReserves>>>,
}

// ============================================================================
// POOL CONFIGURATION
// ============================================================================

#[derive(Debug, Clone)]
struct PoolConfig {
    address: String,
    dex_name: String,
    token0: String,
    token1: String,
    token0_decimals: u8,
    token1_decimals: u8,
}

const POOLS: &[(&str, &str, &str, &str, u8, u8)] = &[
    // QuickSwap pools
    ("0x5757371414417b8C6CAD0a0b9f7dd9Cf0a3D0cA0", "QuickSwap", "WMATIC", "USDC", 18, 6),
    ("0x853Ee4b2A13f8EA3141164f7B1edd271DFc0B28F", "QuickSwap", "WETH", "USDC", 18, 6),
    // SushiSwap pools
    ("0x34965ba0ac2451A34a0471F04CCa3F990b8dea27", "SushiSwap", "WMATIC", "USDC", 18, 6),
    ("0xCD578F016888B57F1b89E0D142B08952570605310", "SushiSwap", "WETH", "USDC", 18, 6),
];

const SYNC_EVENT_TOPIC: &str = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let alchemy_key = std::env::var("ALCHEMY_KEY").expect("ALCHEMY_KEY not set");
    let zmq_push_addr = std::env::var("ZMQ_PUSH_ADDR").unwrap_or_else(|_| "tcp://127.0.0.1:5555".to_string());

    let app_state = AppState {
        state: Arc::new(RwLock::new(ScannerState {
            connected: false,
            pools_subscribed: 0,
            opportunities_detected: 0,
            last_sync_event: None,
            uptime_seconds: 0,
        })),
        opportunities: Arc::new(RwLock::new(Vec::new())),
        pools: Arc::new(RwLock::new(std::collections::HashMap::new())),
    };

    // Start WebSocket scanner
    let scanner_state = app_state.clone();
    let alchemy_key_clone = alchemy_key.clone();
    let zmq_addr_clone = zmq_push_addr.clone();
    tokio::spawn(async move {
        if let Err(e) = run_scanner(&alchemy_key_clone, &zmq_addr_clone, scanner_state).await {
            error!("Scanner error: {}", e);
        }
    });

    // Start HTTP status server
    let app = Router::new()
        .route("/status", get(status_handler))
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    info!("HTTP server listening on 0.0.0.0:8080");

    axum::serve(listener, app).await?;

    Ok(())
}

// ============================================================================
// SCANNER
// ============================================================================

async fn run_scanner(alchemy_key: &str, zmq_addr: &str, app_state: AppState) -> Result<()> {
    let wss_url = format!("wss://polygon-mainnet.g.alchemy.com/v2/{}", alchemy_key);

    info!("Connecting to Alchemy WebSocket: {}", wss_url);
    let (ws_stream, _) = connect_async(&wss_url).await?;
    info!("Connected to Alchemy");

    {
        let mut state = app_state.state.write().await;
        state.connected = true;
    }

    let (mut write, mut read) = ws_stream.split();
    use futures::SinkExt;

    // Subscribe to all pools
    for (addr, dex, token0, token1, _, _) in POOLS {
        let sub_msg = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_subscribe",
            "params": ["logs", {
                "address": addr,
                "topics": [SYNC_EVENT_TOPIC]
            }]
        });

        write.send(tokio_tungstenite::tungstenite::Message::Text(sub_msg.to_string())).await?;
        info!("Subscribed to {} {}/{}", dex, token0, token1);
    }

    {
        let mut state = app_state.state.write().await;
        state.pools_subscribed = POOLS.len();
    }

    // Initialize ZeroMQ PUSH socket
    let ctx = Context::new();
    let socket = ctx.socket(zmq::PUSH)?;
    socket.connect(&zmq_addr)?;
    info!("Connected to ZeroMQ PUSH at {}", zmq_addr);

    // Listen for Sync events
    use futures::StreamExt;
    while let Some(msg) = read.next().await {
        match msg {
            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(params) = data.get("params").and_then(|p| p.get("result")) {
                        if let Some(log_data) = params.get("data").and_then(|d| d.as_str()) {
                            if let Some(address) = params.get("address").and_then(|a| a.as_str()) {
                                // Decode Sync event
                                match decode_sync_event(log_data) {
                                    Ok((reserve0, reserve1)) => {
                                        // Find pool config
                                        if let Some((_, dex, token0, token1, decimals0, decimals1)) = 
                                            POOLS.iter().find(|(addr, _, _, _, _, _)| addr.to_lowercase() == address.to_lowercase()) {
                                            
                                            // Convert to human-readable format
                                            let reserve0_f64 = reserve0 as f64 / 10f64.powi(*decimals0 as i32);
                                            let reserve1_f64 = reserve1 as f64 / 10f64.powi(*decimals1 as i32);

                                            let pool = PoolReserves {
                                                address: address.to_string(),
                                                reserve0: reserve0_f64,
                                                reserve1: reserve1_f64,
                                                token0_symbol: token0.to_string(),
                                                token1_symbol: token1.to_string(),
                                                timestamp: std::time::SystemTime::now()
                                                    .duration_since(std::time::UNIX_EPOCH)
                                                    .unwrap()
                                                    .as_secs(),
                                            };

                                            // Update pool reserves
                                            {
                                                let mut pools_map = app_state.pools.write().await;
                                                pools_map.insert(address.to_lowercase(), pool);
                                            }

                                            // Detect opportunities
                                            let opportunities = detect_opportunities(&app_state.pools.read().await).await;
                                            
                                            for opp in opportunities {
                                                info!("🚀 Opportunity: {} {} → {} spread={:.3}% profit=${:.2}", 
                                                    opp.dex_a, opp.token_in, opp.dex_b, opp.spread_pct, opp.expected_profit_usd);
                                                
                                                // Push to Keeper via ZeroMQ
                                                if let Ok(opp_json) = serde_json::to_string(&opp) {
                                                    let _ = socket.send(&opp_json, 0);
                                                }

                                                // Update state
                                                {
                                                    let mut opps = app_state.opportunities.write().await;
                                                    opps.push(opp);
                                                    if opps.len() > 1000 {
                                                        opps.remove(0);
                                                    }

                                                    let mut state = app_state.state.write().await;
                                                    state.opportunities_detected += 1;
                                                    state.last_sync_event = Some(chrono::Utc::now().to_rfc3339());
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => warn!("Failed to decode Sync event: {}", e),
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => error!("WebSocket error: {}", e),
            _ => {}
        }
    }

    Ok(())
}

// ============================================================================
// SYNC EVENT DECODING
// ============================================================================

/// Decode Uniswap V2 Sync event
/// Event signature: Sync(uint112 reserve0, uint112 reserve1)
/// Data format: 0x + 64 hex chars (reserve0) + 64 hex chars (reserve1)
fn decode_sync_event(data: &str) -> Result<(u128, u128)> {
    let hex_str = data.strip_prefix("0x").unwrap_or(data);
    
    if hex_str.len() < 128 {
        return Err(anyhow::anyhow!("Invalid Sync event data length: {}", hex_str.len()));
    }

    // Extract reserve0 and reserve1 (each is 32 bytes = 64 hex chars)
    let reserve0_hex = &hex_str[0..64];
    let reserve1_hex = &hex_str[64..128];

    // Parse as u128
    let reserve0 = u128::from_str_radix(reserve0_hex, 16)
        .map_err(|e| anyhow::anyhow!("Failed to parse reserve0: {}", e))?;
    let reserve1 = u128::from_str_radix(reserve1_hex, 16)
        .map_err(|e| anyhow::anyhow!("Failed to parse reserve1: {}", e))?;

    Ok((reserve0, reserve1))
}

// ============================================================================
// PRICE DISCOVERY & ARBITRAGE DETECTION
// ============================================================================

async fn detect_opportunities(pools: &std::collections::HashMap<String, PoolReserves>) -> Vec<Opportunity> {
    let mut opportunities = Vec::new();

    // Group pools by pair
    let mut pair_pools: std::collections::HashMap<String, Vec<&PoolReserves>> = std::collections::HashMap::new();
    
    for pool in pools.values() {
        let pair_key = format!("{}/{}", pool.token0_symbol, pool.token1_symbol);
        pair_pools.entry(pair_key).or_insert_with(Vec::new).push(pool);
    }

    // Check each pair for arbitrage
    for (pair, pair_pools_vec) in pair_pools {
        if pair_pools_vec.len() < 2 {
            continue; // Need at least 2 DEXes for arbitrage
        }

        // Calculate prices for each pool
        let mut prices: Vec<(&PoolReserves, f64)> = pair_pools_vec
            .iter()
            .map(|pool| {
                let price = pool.reserve1 / pool.reserve0; // token1 per token0
                (*pool, price)
            })
            .collect();

        prices.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        if prices.len() >= 2 {
            let (pool_a, price_a) = prices[0];
            let (pool_b, price_b) = prices[prices.len() - 1];

            let spread_pct = ((price_b - price_a) / price_a) * 100.0;

            // Minimum spread to be profitable (0.3% to account for gas)
            if spread_pct > 0.3 {
                // Calculate trade amounts
                let amount_in = 1000.0; // 1000 of token0
                
                // Swap on cheaper DEX (pool_a)
                let amount_out_a = calculate_output(amount_in, pool_a.reserve0, pool_a.reserve1);
                
                // Swap back on expensive DEX (pool_b)
                let amount_out_b = calculate_output(amount_out_a, pool_b.reserve1, pool_b.reserve0);
                
                let profit = amount_out_b - amount_in;
                let profit_pct = (profit / amount_in) * 100.0;

                // Rough USD estimation (assuming USDC is token1)
                let profit_usd = profit * price_b * 0.5; // Rough estimate

                if profit > 0.0 && profit_usd > 1.0 {
                    opportunities.push(Opportunity {
                        id: uuid::Uuid::new_v4().to_string(),
                        pair: pair.clone(),
                        dex_a: pool_a.address.clone(),
                        dex_b: pool_b.address.clone(),
                        spread_pct,
                        token_in: pool_a.token0_symbol.clone(),
                        amount_in,
                        amount_out_dex_a: amount_out_a,
                        amount_out_dex_b: amount_out_b,
                        expected_profit_usd: profit_usd,
                        confidence: (spread_pct / 1.0).min(0.95), // Confidence based on spread
                        detected_at: chrono::Utc::now().to_rfc3339(),
                    });
                }
            }
        }
    }

    opportunities
}

/// Calculate output using x*y=k formula
/// Input: amount_in, reserve_in, reserve_out
/// Output: amount_out (accounting for 0.3% fee)
fn calculate_output(amount_in: f64, reserve_in: f64, reserve_out: f64) -> f64 {
    let fee_factor = 0.997; // 0.3% fee
    let amount_in_with_fee = amount_in * fee_factor;
    let numerator = amount_in_with_fee * reserve_out;
    let denominator = reserve_in + amount_in_with_fee;
    numerator / denominator
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

async fn status_handler(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let scanner_state = state.state.read().await;
    let opps = state.opportunities.read().await;
    let pools = state.pools.read().await;

    (
        StatusCode::OK,
        Json(json!({
            "connected": scanner_state.connected,
            "pools_subscribed": scanner_state.pools_subscribed,
            "pools_active": pools.len(),
            "opportunities_detected": scanner_state.opportunities_detected,
            "last_sync_event": scanner_state.last_sync_event,
            "recent_opportunities": opps.iter().rev().take(20).collect::<Vec<_>>(),
            "uptime_seconds": scanner_state.uptime_seconds,
        })),
    )
}
