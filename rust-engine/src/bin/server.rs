use axum::Router;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing_subscriber;

use mev_arb_engine::{
    config::Config,
    server::{create_router, ServerState},
    types::{KeeperStats, ScannerStats},
};

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Load configuration
    let config = Config::from_env();
    tracing::info!("Starting MEV Arbitrage Server");
    tracing::info!("Network: {}", config.network);
    tracing::info!("Server: {}:{}", config.server_host, config.server_port);

    // Create server state
    let state = ServerState {
        scanner_stats: Arc::new(RwLock::new(ScannerStats::default())),
        keeper_stats: Arc::new(RwLock::new(KeeperStats::default())),
        recent_trades: Arc::new(RwLock::new(Vec::new())),
        opportunities: Arc::new(RwLock::new(Vec::new())),
    };

    // Create router
    let app = create_router(state)
        .layer(CorsLayer::permissive())
        .into_make_service();

    // Create listener
    let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.server_host, config.server_port))
        .await
        .unwrap();

    tracing::info!("Server listening on {}:{}", config.server_host, config.server_port);

    // Start server
    axum::serve(listener, app).await.unwrap();
}
