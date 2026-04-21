use crate::types::*;
use std::collections::{HashMap, VecDeque};
use std::time::Instant;

/// Optimized Bellman-Ford for MEV arbitrage detection
/// Finds negative cycles in exchange rate graphs
pub struct Scanner {
    vertices: usize,
    edges: Vec<Edge>,
    distances: Vec<f64>,
    parents: Vec<Option<usize>>,
}

#[derive(Debug, Clone)]
struct Edge {
    from: usize,
    to: usize,
    weight: f64, // log(price)
    pool_address: String,
    dex: String,
}

impl Scanner {
    pub fn new(capacity: usize) -> Self {
        Scanner {
            vertices: 0,
            edges: Vec::with_capacity(capacity * 2),
            distances: Vec::with_capacity(capacity),
            parents: Vec::with_capacity(capacity),
        }
    }

    /// Add a pool (bidirectional edge)
    pub fn add_pool(&mut self, pool: &PoolState, dex: &str) {
        // Ensure vertices array is large enough
        let max_vertex = std::cmp::max(
            self.token_to_vertex(&pool.token0),
            self.token_to_vertex(&pool.token1),
        );
        
        if max_vertex >= self.vertices {
            self.vertices = max_vertex + 1;
            self.distances.resize(self.vertices, f64::INFINITY);
            self.parents.resize(self.vertices, None);
        }

        let from = self.token_to_vertex(&pool.token0);
        let to = self.token_to_vertex(&pool.token1);

        // Forward edge (token0 -> token1)
        let price_forward = (pool.reserve1 as f64) / (pool.reserve0 as f64);
        let weight_forward = price_forward.ln();
        
        self.edges.push(Edge {
            from,
            to,
            weight: weight_forward,
            pool_address: pool.address.clone(),
            dex: dex.to_string(),
        });

        // Reverse edge (token1 -> token0)
        let price_reverse = (pool.reserve0 as f64) / (pool.reserve1 as f64);
        let weight_reverse = price_reverse.ln();
        
        self.edges.push(Edge {
            from: to,
            to: from,
            weight: weight_reverse,
            pool_address: pool.address.clone(),
            dex: dex.to_string(),
        });
    }

    /// Find all negative cycles (arbitrage opportunities)
    pub fn find_opportunities(&mut self) -> Vec<ArbitrageOpportunity> {
        let start_time = Instant::now();
        let mut opportunities = Vec::new();

        // Initialize distances
        for i in 0..self.vertices {
            self.distances[i] = f64::INFINITY;
            self.parents[i] = None;
        }
        self.distances[0] = 0.0;

        // Bellman-Ford: relax edges V-1 times
        for _ in 0..self.vertices - 1 {
            for edge in &self.edges {
                if self.distances[edge.from] != f64::INFINITY {
                    let new_dist = self.distances[edge.from] + edge.weight;
                    if new_dist < self.distances[edge.to] {
                        self.distances[edge.to] = new_dist;
                        self.parents[edge.to] = Some(edge.from);
                    }
                }
            }
        }

        // Detect negative cycles
        for edge in &self.edges {
            if self.distances[edge.from] != f64::INFINITY {
                let new_dist = self.distances[edge.from] + edge.weight;
                if new_dist < self.distances[edge.to] {
                    // Found a negative cycle
                    if let Some(cycle) = self.extract_cycle(edge.to) {
                        opportunities.push(cycle);
                    }
                }
            }
        }

        let latency_ms = start_time.elapsed().as_millis() as f64;
        tracing::debug!("Scanner found {} opportunities in {:.2}ms", opportunities.len(), latency_ms);

        opportunities
    }

    /// Extract cycle path from negative cycle detection
    fn extract_cycle(&self, mut vertex: usize) -> Option<ArbitrageOpportunity> {
        let mut path = Vec::new();
        let mut visited = std::collections::HashSet::new();

        // Trace back to find cycle
        while let Some(parent) = self.parents[vertex] {
            if visited.contains(&vertex) {
                break; // Cycle detected
            }
            visited.insert(vertex);
            path.push(vertex);
            vertex = parent;
        }

        if path.len() < 2 {
            return None;
        }

        path.reverse();

        // Calculate profit
        let mut profit_multiplier = 1.0;
        for i in 0..path.len() {
            let from = path[i];
            let to = path[(i + 1) % path.len()];
            
            // Find edge
            for edge in &self.edges {
                if edge.from == from && edge.to == to {
                    profit_multiplier *= edge.weight.exp();
                    break;
                }
            }
        }

        let profit_percent = (profit_multiplier - 1.0) * 100.0;
        
        if profit_percent > 0.1 {
            Some(ArbitrageOpportunity {
                id: format!("opp_{}", uuid::Uuid::new_v4()),
                tokens: path.iter().map(|v| self.vertex_to_token(*v)).collect(),
                path: path.iter().map(|v| self.vertex_to_token(*v)).collect(),
                profit_usd: profit_percent * 100.0, // Estimate
                profit_percent,
                mev_risk_score: 0.0, // Will be calculated by Queen
                is_safe: true,
                detected_at: chrono::Utc::now().timestamp_millis() as u64,
                expires_at: chrono::Utc::now().timestamp_millis() as u64 + 5000, // 5 second expiry
            })
        } else {
            None
        }
    }

    fn token_to_vertex(&self, token: &str) -> usize {
        // Simple hash-based vertex assignment
        let mut hash = 0usize;
        for byte in token.as_bytes() {
            hash = hash.wrapping_mul(31).wrapping_add(*byte as usize);
        }
        hash % 1000 // Max 1000 vertices
    }

    fn vertex_to_token(&self, vertex: usize) -> String {
        format!("token_{}", vertex)
    }

    pub fn clear(&mut self) {
        self.edges.clear();
        self.distances.fill(f64::INFINITY);
        self.parents.fill(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scanner_initialization() {
        let scanner = Scanner::new(100);
        assert_eq!(scanner.vertices, 0);
        assert!(scanner.edges.is_empty());
    }

    #[test]
    fn test_add_pool() {
        let mut scanner = Scanner::new(100);
        let pool = PoolState {
            address: "0x123".to_string(),
            token0: "USDC".to_string(),
            token1: "WMATIC".to_string(),
            reserve0: 1_000_000_000_000_000_000,
            reserve1: 1_000_000_000_000_000_000,
            fee: 3000,
            last_update: 0,
        };

        scanner.add_pool(&pool, "quickswap");
        assert_eq!(scanner.edges.len(), 2); // Bidirectional
    }
}

// UUID support
mod uuid {
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    pub struct Uuid(String);

    impl Uuid {
        pub fn new_v4() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let counter = COUNTER.fetch_add(1, Ordering::SeqCst);
            Uuid(format!("{:x}-{:x}", timestamp, counter))
        }
    }

    impl std::fmt::Display for Uuid {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "{}", self.0)
        }
    }
}
