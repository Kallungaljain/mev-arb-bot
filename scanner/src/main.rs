// ─── Elite Scanner — Main Entry Point ────────────────────────────────────────
//
// Architecture:
//   1. Subscribe to Polygon via Alchemy WebSocket (eth_subscribe "logs")
//   2. Filter for Sync events on QuickSwap + SushiSwap V2 pairs
//   3. Decode reserve updates in real time
//   4. Run the arbitrage opportunity engine on every reserve change
//   5. POST profitable opportunities to the Keeper service via HTTP

mod config;
mod pairs;
mod scanner;
mod engine;
mod keeper;
mod metrics;

use anyhow::Result;
use tracing::{info, error};
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<()> {
    // ── Logging ────────────────────────────────────────────────────────────────
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("elite_scanner=info,warn"))
        )
        .with_target(false)
        .compact()
        .init();

    info!("⚡ Elite Scanner v{} starting", env!("CARGO_PKG_VERSION"));

    // ── Config ─────────────────────────────────────────────────────────────────
    let cfg = config::Config::from_env()?;
    info!("Alchemy WS: {}", cfg.alchemy_ws_url_masked());
    info!("Keeper URL: {}", cfg.keeper_url);
    info!("Pairs loaded: {}", pairs::ALL_PAIRS.len());

    // ── Metrics server ─────────────────────────────────────────────────────────
    let metrics_port = cfg.metrics_port;
    tokio::spawn(async move {
        if let Err(e) = metrics::serve(metrics_port).await {
            error!("Metrics server error: {}", e);
        }
    });

    // ── Main scanner loop with reconnect ───────────────────────────────────────
    loop {
        match scanner::run(&cfg).await {
            Ok(_) => {
                info!("Scanner exited cleanly, restarting...");
            }
            Err(e) => {
                error!("Scanner error: {}. Reconnecting in 5s...", e);
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    }
}
