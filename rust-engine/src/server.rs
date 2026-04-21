use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::types::*;

pub struct ServerState {
    pub scanner_stats: Arc<RwLock<ScannerStats>>,
    pub keeper_stats: Arc<RwLock<KeeperStats>>,
    pub recent_trades: Arc<RwLock<Vec<Trade>>>,
    pub opportunities: Arc<RwLock<Vec<ArbitrageOpportunity>>>,
}

/// Create the API router
pub fn create_router(state: ServerState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/stats", get(get_stats))
        .route("/api/trades", get(get_trades))
        .route("/api/opportunities", get(get_opportunities))
        .route("/api/start", post(start_bot))
        .route("/api/stop", post(stop_bot))
        .with_state(Arc::new(state))
}

/// Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().timestamp_millis()
    }))
}

/// Get current stats
async fn get_stats(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    let scanner_stats = state.scanner_stats.read().await.clone();
    let keeper_stats = state.keeper_stats.read().await.clone();

    Json(json!({
        "scanner": scanner_stats,
        "keeper": keeper_stats,
        "timestamp": chrono::Utc::now().timestamp_millis()
    }))
}

/// Get recent trades
async fn get_trades(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    let trades = state.recent_trades.read().await.clone();

    Json(ApiResponse::ok(trades))
}

/// Get current opportunities
async fn get_opportunities(State(state): State<Arc<ServerState>>) -> impl IntoResponse {
    let opportunities = state.opportunities.read().await.clone();

    Json(ApiResponse::ok(opportunities))
}

/// Start bot
async fn start_bot(State(_state): State<Arc<ServerState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "status": "started",
            "message": "Bot started successfully"
        })),
    )
}

/// Stop bot
async fn stop_bot(State(_state): State<Arc<ServerState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "status": "stopped",
            "message": "Bot stopped successfully"
        })),
    )
}

/// WebSocket message handler
pub async fn handle_websocket_message(
    msg: String,
    state: Arc<ServerState>,
) -> Result<String, String> {
    match msg.as_str() {
        "get_stats" => {
            let scanner_stats = state.scanner_stats.read().await.clone();
            let keeper_stats = state.keeper_stats.read().await.clone();

            Ok(serde_json::to_string(&json!({
                "type": "stats",
                "data": {
                    "scanner": scanner_stats,
                    "keeper": keeper_stats
                }
            }))
            .unwrap())
        }
        "get_trades" => {
            let trades = state.recent_trades.read().await.clone();

            Ok(serde_json::to_string(&json!({
                "type": "trades",
                "data": trades
            }))
            .unwrap())
        }
        "get_opportunities" => {
            let opportunities = state.opportunities.read().await.clone();

            Ok(serde_json::to_string(&json!({
                "type": "opportunities",
                "data": opportunities
            }))
            .unwrap())
        }
        _ => Err("Unknown message type".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_state_creation() {
        let state = ServerState {
            scanner_stats: Arc::new(RwLock::new(ScannerStats::default())),
            keeper_stats: Arc::new(RwLock::new(KeeperStats::default())),
            recent_trades: Arc::new(RwLock::new(Vec::new())),
            opportunities: Arc::new(RwLock::new(Vec::new())),
        };

        assert_eq!(state.recent_trades.blocking_read().len(), 0);
    }
}
