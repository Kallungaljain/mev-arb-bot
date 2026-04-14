// ─── Prometheus Metrics ───────────────────────────────────────────────────────

use anyhow::Result;
use lazy_static::lazy_static;
use prometheus::{Counter, Encoder, TextEncoder, register_counter};
use std::net::SocketAddr;

lazy_static! {
    pub static ref SCAN_COUNT: Counter = register_counter!(
        "elite_scanner_sync_events_total",
        "Total number of Sync events processed"
    ).unwrap();

    pub static ref OPPORTUNITY_COUNT: Counter = register_counter!(
        "elite_scanner_opportunities_total",
        "Total number of profitable opportunities detected"
    ).unwrap();

    pub static ref WS_RECONNECT_COUNT: Counter = register_counter!(
        "elite_scanner_ws_reconnects_total",
        "Total number of WebSocket reconnections"
    ).unwrap();
}

/// Serve Prometheus metrics on /metrics
pub async fn serve(port: u16) -> Result<()> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("Metrics server listening on http://0.0.0.0:{}/metrics", port);

    loop {
        let (mut stream, _) = listener.accept().await?;
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;

            let encoder = TextEncoder::new();
            let metric_families = prometheus::gather();
            let mut body = Vec::new();
            let _ = encoder.encode(&metric_families, &mut body);

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; version=0.0.4\r\nContent-Length: {}\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.write_all(&body).await;
        });
    }
}
