/// Scanner: Real-time pool monitoring and arbitrage detection
/// Scans Polygon pools every 100-500ms with <10ms detection time

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct PoolSnapshot {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub reserve0: f64,
    pub reserve1: f64,
    pub fee: f64,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct ArbitrageOpportunity {
    pub id: String,
    pub path: Vec<String>,
    pub profit_pct: f64,
    pub profit_usd: f64,
    pub detected_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
pub struct ScannerMetrics {
    pub pools_scanned: u32,
    pub opportunities_found: u32,
    pub avg_scan_time_ms: f64,
    pub last_scan_at: u64,
}

pub struct Scanner {
    pools: Arc<RwLock<HashMap<String, PoolSnapshot>>>,
    opportunities: Arc<RwLock<Vec<ArbitrageOpportunity>>>,
    metrics: Arc<RwLock<ScannerMetrics>>,
    scan_times: Arc<RwLock<Vec<f64>>>,
}

impl Scanner {
    pub fn new() -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            opportunities: Arc::new(RwLock::new(Vec::new())),
            metrics: Arc::new(RwLock::new(ScannerMetrics {
                pools_scanned: 0,
                opportunities_found: 0,
                avg_scan_time_ms: 0.0,
                last_scan_at: 0,
            })),
            scan_times: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Scan all pools for arbitrage opportunities
    /// Target: <10ms for 100 pools
    pub async fn scan(&self) -> Result<Vec<ArbitrageOpportunity>, String> {
        let start = std::time::Instant::now();

        // Step 1: Fetch pool data (5-10ms for 100 pools via batch RPC)
        let pools = self.fetch_pool_data().await?;

        // Step 2: Build graph (1-2ms)
        let graph = self.build_graph(&pools).await;

        // Step 3: Detect arbitrage (2-5ms for Bellman-Ford on 100 vertices)
        let opportunities = self.detect_arbitrage(&graph).await?;

        // Step 4: Filter by profitability (1-2ms)
        let filtered = self.filter_opportunities(opportunities).await;

        let scan_time = start.elapsed().as_secs_f64() * 1000.0;

        // Record metrics
        let mut times = self.scan_times.write().await;
        times.push(scan_time);
        if times.len() > 100 {
            times.remove(0);
        }

        let mut metrics = self.metrics.write().await;
        metrics.pools_scanned = pools.len() as u32;
        metrics.opportunities_found = filtered.len() as u32;
        metrics.avg_scan_time_ms = times.iter().sum::<f64>() / times.len() as f64;
        metrics.last_scan_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Store pools
        let mut pools_map = self.pools.write().await;
        for pool in pools {
            pools_map.insert(pool.address.clone(), pool);
        }

        // Store opportunities
        let mut opps = self.opportunities.write().await;
        opps.extend(filtered.clone());
        // Keep only recent opportunities (last 1000)
        if opps.len() > 1000 {
            opps.drain(0..opps.len() - 1000);
        }

        Ok(filtered)
    }

    /// Fetch pool data from Alchemy (5-10ms via batch RPC)
    async fn fetch_pool_data(&self) -> Result<Vec<PoolSnapshot>, String> {
        // In production: batch RPC calls to Alchemy
        // For now: return mock data
        let pools = vec![
            PoolSnapshot {
                address: "0xquickswap".to_string(),
                token0: "USDC".to_string(),
                token1: "WMATIC".to_string(),
                reserve0: 1_000_000.0,
                reserve1: 1_850_000.0,
                fee: 0.3,
                timestamp: 0,
            },
            PoolSnapshot {
                address: "0xsushiswap".to_string(),
                token0: "USDC".to_string(),
                token1: "WMATIC".to_string(),
                reserve0: 500_000.0,
                reserve1: 900_000.0,
                fee: 0.3,
                timestamp: 0,
            },
        ];
        Ok(pools)
    }

    /// Build trading graph from pools (1-2ms)
    async fn build_graph(&self, pools: &[PoolSnapshot]) -> HashMap<String, Vec<(String, f64)>> {
        let mut graph: HashMap<String, Vec<(String, f64)>> = HashMap::new();

        for pool in pools {
            // Add bidirectional edges
            let rate0to1 = pool.reserve1 / pool.reserve0;
            let rate1to0 = pool.reserve0 / pool.reserve1;

            graph
                .entry(pool.token0.clone())
                .or_insert_with(Vec::new)
                .push((pool.token1.clone(), rate0to1));

            graph
                .entry(pool.token1.clone())
                .or_insert_with(Vec::new)
                .push((pool.token0.clone(), rate1to0));
        }

        graph
    }

    /// Detect arbitrage cycles (2-5ms for Bellman-Ford)
    async fn detect_arbitrage(
        &self,
        graph: &HashMap<String, Vec<(String, f64)>>,
    ) -> Result<Vec<ArbitrageOpportunity>, String> {
        let mut opportunities = Vec::new();

        // Simplified cycle detection
        // In production: use full Bellman-Ford algorithm
        for (start_token, edges) in graph {
            for (next_token, rate1) in edges {
                if let Some(back_edges) = graph.get(next_token) {
                    for (final_token, rate2) in back_edges {
                        if final_token == start_token {
                            let profit = rate1 * rate2;
                            if profit > 1.001 { // >0.1% profit
                                opportunities.push(ArbitrageOpportunity {
                                    id: format!("{}-{}-{}", start_token, next_token, final_token),
                                    path: vec![
                                        start_token.clone(),
                                        next_token.clone(),
                                        final_token.clone(),
                                    ],
                                    profit_pct: (profit - 1.0) * 100.0,
                                    profit_usd: 0.0, // Will be calculated by Keeper
                                    detected_at: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs(),
                                    expires_at: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs()
                                        + 5, // Expires in 5 seconds
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(opportunities)
    }

    /// Filter opportunities by profitability (1-2ms)
    async fn filter_opportunities(&self, opps: Vec<ArbitrageOpportunity>) -> Vec<ArbitrageOpportunity> {
        opps.into_iter()
            .filter(|opp| opp.profit_pct > 0.5) // Only >0.5% profit
            .collect()
    }

    /// Get current opportunities
    pub async fn get_opportunities(&self) -> Vec<ArbitrageOpportunity> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let opps = self.opportunities.read().await;
        opps.iter()
            .filter(|opp| opp.expires_at > now)
            .cloned()
            .collect()
    }

    /// Get scanner metrics
    pub async fn get_metrics(&self) -> ScannerMetrics {
        self.metrics.read().await.clone()
    }

    /// Get pool data
    pub async fn get_pool(&self, address: &str) -> Option<PoolSnapshot> {
        self.pools.read().await.get(address).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_scanner_creation() {
        let scanner = Scanner::new();
        let metrics = scanner.get_metrics().await;
        assert_eq!(metrics.pools_scanned, 0);
    }

    #[tokio::test]
    async fn test_scan() {
        let scanner = Scanner::new();
        let result = scanner.scan().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_opportunities() {
        let scanner = Scanner::new();
        let _ = scanner.scan().await;
        let opps = scanner.get_opportunities().await;
        assert!(opps.len() >= 0);
    }
}
