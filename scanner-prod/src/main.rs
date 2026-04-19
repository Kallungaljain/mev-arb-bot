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
use tracing::{error, info};
use zmq::Context;

// ============================================================================
// TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolReserves {
    pub reserve0: U256,
    pub reserve1: U256,
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
    pub amount_in: String,
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

const QUICKSWAP_WMATIC_USDC: &str = "0x5757371414417b8C6CAD0a0b9f7dd9Cf0a3D0cA0";
const SUSHISWAP_WMATIC_USDC: &str = "0x34965ba0ac2451A34a0471F04CCa3F990b8dea27";
const QUICKSWAP_WETH_USDC: &str = "0x853Ee4b2A13f8EA3141164f7B1edd271DFc0B28F";
const SUSHISWAP_WETH_USDC: &str = "0xCD578F016888B57F1b89E0D142B08952570605310";

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

    // Connect to Alchemy WebSocket
    info!("Connecting to Alchemy WebSocket: {}", wss_url);
    let (ws_stream, _) = connect_async(&wss_url).await?;
    info!("Connected to Alchemy");

    // Update state
    {
        let mut state = app_state.state.write().await;
        state.connected = true;
    }

    // Subscribe to Sync events on all pools
    let pools = vec![
        ("QuickSwap WMATIC/USDC", QUICKSWAP_WMATIC_USDC),
        ("SushiSwap WMATIC/USDC", SUSHISWAP_WMATIC_USDC),
        ("QuickSwap WETH/USDC", QUICKSWAP_WETH_USDC),
        ("SushiSwap WETH/USDC", SUSHISWAP_WETH_USDC),
    ];

    let (mut write, mut read) = ws_stream.split();
    use futures::SinkExt;

    for (pool_name, pool_addr) in &pools {
        let sub_msg = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_subscribe",
            "params": ["logs", {
                "address": pool_addr,
                "topics": [SYNC_EVENT_TOPIC]
            }]
        });

        write.send(tokio_tungstenite::tungstenite::Message::Text(sub_msg.to_string())).await?;
        info!("Subscribed to {} ({})", pool_name, pool_addr);
    }

    {
        let mut state = app_state.state.write().await;
        state.pools_subscribed = pools.len();
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
                        // Parse Sync event
                        if let Some(log_data) = params.get("data").and_then(|d| d.as_str()) {
                            if let Ok(decoded) = decode_sync_event(log_data) {
                                let address = params.get("address").and_then(|a| a.as_str()).unwrap_or("unknown");
                                
                                // Update pool reserves
                                {
                                    let mut pools_map = app_state.pools.write().await;
                                    pools_map.insert(
                                        address.to_string(),
                                        PoolReserves {
                                            reserve0: decoded.0,
                                            reserve1: decoded.1,
                                            timestamp: std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap()
                                                .as_secs(),
                                        },
                                    );
                                }

                                // Detect opportunities
                                let opportunities = detect_opportunities(&app_state.pools.read().await).await;
                                if !opportunities.is_empty() {
                                    for opp in opportunities {
                                        info!("Opportunity detected: {} spread={:.2}%", opp.pair, opp.spread_pct);
                                        
                                        // Push to Keeper via ZeroMQ
                                        let opp_json = serde_json::to_string(&opp)?;
                                        socket.send(&opp_json, 0)?;

                                        // Update state
                                        {
                                            let mut opps = app_state.opportunities.write().await;
                                            opps.push(opp.clone());
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
// HELPERS
// ============================================================================

fn decode_sync_event(data: &str) -> Result<(U256, U256)> {
    // Remove 0x prefix
    let hex_str = data.strip_prefix("0x").unwrap_or(data);
    
    // Sync event has 2 uint112 values (224 bits total + 32 bits padding)
    // Data format: 0x + 64 chars (reserve0) + 64 chars (reserve1)
    if hex_str.len() < 128 {
        return Err(anyhow::anyhow!("Invalid Sync event data length"));
    }

    let reserve0_hex = &hex_str[0..64];
    let reserve1_hex = &hex_str[64..128];

    let reserve0 = U256::from_str_radix(reserve0_hex, 16)?;
    let reserve1 = U256::from_str_radix(reserve1_hex, 16)?;

    Ok((reserve0, reserve1))
}

async fn detect_opportunities(pools: &std::collections::HashMap<String, PoolReserves>) -> Vec<Opportunity> {
    let mut opportunities = Vec::new();

    // Get prices from pools
    let quickswap_wmatic_usdc = pools.get(QUICKSWAP_WMATIC_USDC);
    let sushiswap_wmatic_usdc = pools.get(SUSHISWAP_WMATIC_USDC);

    if let (Some(quick), Some(sushi)) = (quickswap_wmatic_usdc, sushiswap_wmatic_usdc) {
        // Calculate prices (USDC per WMATIC)
        let quick_price = quick.reserve1.as_u128() as f64 / quick.reserve0.as_u128() as f64;
        let sushi_price = sushi.reserve1.as_u128() as f64 / sushi.reserve0.as_u128() as f64;

        // Calculate spread
        let spread = ((quick_price - sushi_price).abs() / quick_price.min(sushi_price)) * 100.0;

        if spread > 0.2 {
            // Profitable opportunity
            opportunities.push(Opportunity {
                id: uuid::Uuid::new_v4().to_string(),
                pair: "WMATIC/USDC".to_string(),
                dex_a: "QuickSwap".to_string(),
                dex_b: "SushiSwap".to_string(),
                spread_pct: spread,
                token_in: "WMATIC".to_string(),
                amount_in: "1000".to_string(), // 1000 WMATIC
                expected_profit_usd: spread * 10.0, // Rough estimate
                confidence: 0.85,
                detected_at: chrono::Utc::now().to_rfc3339(),
            });
        }
    }

    opportunities
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

async fn status_handler(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let scanner_state = state.state.read().await;
    let opps = state.opportunities.read().await;

    (
        StatusCode::OK,
        Json(json!({
            "connected": scanner_state.connected,
            "pools_subscribed": scanner_state.pools_subscribed,
            "opportunities_detected": scanner_state.opportunities_detected,
            "last_sync_event": scanner_state.last_sync_event,
            "recent_opportunities": opps.iter().rev().take(10).collect::<Vec<_>>(),
            "uptime_seconds": scanner_state.uptime_seconds,
        })),
    )
}
