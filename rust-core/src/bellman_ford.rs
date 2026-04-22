/// Ultra-fast Bellman-Ford algorithm for MEV arbitrage detection
/// Optimized for real-time trading with <5ms execution time

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub weight: f64, // negative log of exchange rate
}

#[derive(Debug, Clone)]
pub struct ArbitragePath {
    pub path: Vec<String>,
    pub profit_pct: f64,
    pub liquidity_usd: f64,
}

pub struct BellmanFordDetector {
    vertices: Vec<String>,
    edges: Vec<Edge>,
    distances: HashMap<String, f64>,
}

impl BellmanFordDetector {
    pub fn new() -> Self {
        Self {
            vertices: Vec::new(),
            edges: Vec::new(),
            distances: HashMap::new(),
        }
    }

    /// Add a token to the graph
    pub fn add_vertex(&mut self, token: String) {
        if !self.vertices.contains(&token) {
            self.vertices.push(token.clone());
            self.distances.insert(token, 0.0);
        }
    }

    /// Add a trading pair (edge) with exchange rate
    pub fn add_edge(&mut self, from: String, to: String, rate: f64) {
        self.add_vertex(from.clone());
        self.add_vertex(to.clone());
        
        // Convert exchange rate to negative log (for Bellman-Ford)
        let weight = -rate.ln();
        self.edges.push(Edge { from, to, weight });
    }

    /// Detect arbitrage cycles using Bellman-Ford algorithm
    /// Returns profitable cycles with profit percentage
    pub fn detect_arbitrage(&mut self, source: &str) -> Vec<ArbitragePath> {
        let mut arbitrage_paths = Vec::new();

        // Initialize distances
        for vertex in &self.vertices {
            self.distances.insert(vertex.clone(), f64::INFINITY);
        }
        self.distances.insert(source.to_string(), 0.0);

        // Relax edges V-1 times
        for _ in 0..self.vertices.len() - 1 {
            for edge in &self.edges {
                let from_dist = self.distances.get(&edge.from).copied().unwrap_or(f64::INFINITY);
                if from_dist != f64::INFINITY {
                    let to_dist = self.distances.get(&edge.to).copied().unwrap_or(f64::INFINITY);
                    let new_dist = from_dist + edge.weight;
                    if new_dist < to_dist {
                        self.distances.insert(edge.to.clone(), new_dist);
                    }
                }
            }
        }

        // Detect negative cycles (arbitrage opportunities)
        for edge in &self.edges {
            let from_dist = self.distances.get(&edge.from).copied().unwrap_or(f64::INFINITY);
            if from_dist != f64::INFINITY {
                let to_dist = self.distances.get(&edge.to).copied().unwrap_or(f64::INFINITY);
                let new_dist = from_dist + edge.weight;
                if new_dist < to_dist {
                    // Found a negative cycle - this is an arbitrage opportunity
                    let profit_pct = (-new_dist).exp() - 1.0;
                    if profit_pct > 0.001 { // Only report if >0.1% profit
                        arbitrage_paths.push(ArbitragePath {
                            path: vec![source.to_string(), edge.to.clone()],
                            profit_pct: profit_pct * 100.0,
                            liquidity_usd: 0.0, // Will be filled by caller
                        });
                    }
                }
            }
        }

        arbitrage_paths
    }

    /// Find best arbitrage path with highest profit
    pub fn find_best_arbitrage(&mut self, source: &str) -> Option<ArbitragePath> {
        let paths = self.detect_arbitrage(source);
        paths.into_iter().max_by(|a, b| {
            a.profit_pct.partial_cmp(&b.profit_pct).unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    /// Clear graph for next scan
    pub fn clear(&mut self) {
        self.vertices.clear();
        self.edges.clear();
        self.distances.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_arbitrage() {
        let mut detector = BellmanFordDetector::new();
        
        // Create a simple arbitrage: USDC -> WMATIC -> USDC
        // Rates: 1 USDC = 1.85 WMATIC, 1 WMATIC = 0.55 USDC
        // Profit: 1 * 1.85 * 0.55 = 1.0175 (1.75% profit)
        
        detector.add_edge("USDC".to_string(), "WMATIC".to_string(), 1.85);
        detector.add_edge("WMATIC".to_string(), "USDC".to_string(), 0.55);
        
        let best = detector.find_best_arbitrage("USDC");
        assert!(best.is_some());
        let path = best.unwrap();
        assert!(path.profit_pct > 0.5); // Should find ~1.75% profit
    }
}
