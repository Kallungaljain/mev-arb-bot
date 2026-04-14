// ─── Elite Scanner — WebSocket Pool Event Subscriber ─────────────────────────
//
// Subscribes to Polygon via Alchemy WebSocket and listens for Uniswap V2
// Sync events (topic0: 0x1c411e9a96e071241c2f21f7726b17ae89e3cab4f7c1eff2b7a3dfb6a3e2b5e)
// on all registered DEX pair contracts.
//
// On each Sync event:
//   1. Decode reserve0 and reserve1 from the event data
//   2. Update the in-memory reserve cache for that pool
//   3. Run the arbitrage engine for the affected token pair
//   4. Forward profitable opportunities to the Keeper

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use anyhow::Result;
use tracing::{info, debug, warn};
use serde_json::{json, Value};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::config::Config;
use crate::pairs::{all_pool_addresses, find_pair_by_pool, ALL_PAIRS};
use crate::engine::{ReserveState, run_engine};
use crate::keeper::send_opportunity;
use crate::metrics::{SCAN_COUNT, OPPORTUNITY_COUNT, WS_RECONNECT_COUNT};

// Uniswap V2 Sync event topic
const SYNC_TOPIC: &str = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4f7c1eff2b7a3dfb6a3e2b5e";

pub async fn run(cfg: &Config) -> Result<()> {
    info!("Connecting to Alchemy WebSocket...");

    let (ws_stream, _) = connect_async(&cfg.alchemy_ws_url()).await?;
    info!("WebSocket connected ✓");

    let (mut write, mut read) = ws_stream.split();

    // ── Subscribe to logs for all pool addresses ───────────────────────────────
    let pool_addresses: Vec<Value> = all_pool_addresses()
        .iter()
        .map(|a| json!(a))
        .collect();

    let subscribe_msg = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_subscribe",
        "params": [
            "logs",
            {
                "address": pool_addresses,
                "topics": [SYNC_TOPIC]
            }
        ]
    });

    write.send(Message::Text(subscribe_msg.to_string().into())).await?;
    info!("Subscribed to Sync events on {} pools", all_pool_addresses().len());

    // ── Reserve cache: pool_address → (reserve0, reserve1) ────────────────────
    let reserves: Arc<RwLock<HashMap<String, (u128, u128)>>> =
        Arc::new(RwLock::new(HashMap::new()));

    // ── Event loop ─────────────────────────────────────────────────────────────
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Err(e) = handle_message(&text, cfg, &reserves).await {
                    warn!("Message handling error: {}", e);
                }
            }
            Ok(Message::Ping(data)) => {
                let _ = write.send(Message::Pong(data)).await;
            }
            Ok(Message::Close(_)) => {
                warn!("WebSocket closed by server");
                WS_RECONNECT_COUNT.inc();
                break;
            }
            Err(e) => {
                warn!("WebSocket error: {}", e);
                WS_RECONNECT_COUNT.inc();
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

async fn handle_message(
    text: &str,
    cfg: &Config,
    reserves: &Arc<RwLock<HashMap<String, (u128, u128)>>>,
) -> Result<()> {
    let v: Value = serde_json::from_str(text)?;

    // Ignore subscription confirmation
    if v.get("id").is_some() {
        debug!("Subscription confirmed: {}", text);
        return Ok(());
    }

    // Process log event
    let log = match v.get("params").and_then(|p| p.get("result")) {
        Some(log) => log,
        None => return Ok(()),
    };

    let pool_addr = match log.get("address").and_then(|a| a.as_str()) {
        Some(a) => a.to_lowercase(),
        None => return Ok(()),
    };

    let data = match log.get("data").and_then(|d| d.as_str()) {
        Some(d) => d,
        None => return Ok(()),
    };

    // Decode Sync(uint112 reserve0, uint112 reserve1) from event data
    // Data is 64 hex chars = 32 bytes reserve0 + 32 bytes reserve1
    let data_clean = data.trim_start_matches("0x");
    if data_clean.len() < 128 {
        return Ok(());
    }

    let reserve0 = u128::from_str_radix(&data_clean[..64], 16)?;
    let reserve1 = u128::from_str_radix(&data_clean[64..128], 16)?;

    debug!("Sync {} r0={} r1={}", &pool_addr[..10], reserve0, reserve1);
    SCAN_COUNT.inc();

    // Update reserve cache
    {
        let mut cache = reserves.write().await;
        cache.insert(pool_addr.clone(), (reserve0, reserve1));
    }

    // Find which pair this pool belongs to
    let (pair, is_quickswap) = match find_pair_by_pool(&pool_addr) {
        Some(p) => p,
        None => return Ok(()),
    };

    // Get reserves for both DEXes
    let cache = reserves.read().await;
    let qs_reserves = cache.get(pair.quickswap_pair);
    let ss_reserves = cache.get(pair.sushiswap_pair);

    // Need both sides to compare
    let (qs_r0, qs_r1) = match qs_reserves {
        Some(&(r0, r1)) => (r0, r1),
        None => return Ok(()),
    };
    let (ss_r0, ss_r1) = match ss_reserves {
        Some(&(r0, r1)) => (r0, r1),
        None => return Ok(()),
    };

    drop(cache);

    let state = ReserveState {
        pair,
        qs_reserve0: qs_r0,
        qs_reserve1: qs_r1,
        ss_reserve0: ss_r0,
        ss_reserve1: ss_r1,
        updated_dex_is_quickswap: is_quickswap,
    };

    // Run the opportunity engine
    if let Some(opportunity) = run_engine(&state, cfg) {
        OPPORTUNITY_COUNT.inc();
        info!(
            "🎯 Opportunity: {} | Spread: {:.4}% | Net: ${:.4}",
            pair.name,
            opportunity.spread_pct,
            opportunity.net_profit_usd
        );

        // Forward to Keeper
        if let Err(e) = send_opportunity(&opportunity, cfg).await {
            warn!("Failed to send opportunity to Keeper: {}", e);
        }
    }

    Ok(())
}
