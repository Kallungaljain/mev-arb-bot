use crate::types::*;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use parking_lot::RwLock;

/// Route graph for detecting arbitrage opportunities
/// Builds a graph of pools and tokens, finds profitable cycles
pub struct RouteGraph {
    /// Adjacency list: token -> [(pool, other_token)]
    graph: Arc<RwLock<HashMap<String, Vec<(String, String)>>>>,
    
    /// Pool data
    pools: Arc<RwLock<HashMap<String, PoolState>>>,
    
    /// Cached routes
    routes_cache: Arc<RwLock<Vec<Route>>>,
}

impl RouteGraph {
    pub fn new() -> Self {
        Self {
            graph: Arc::new(RwLock::new(HashMap::new())),
            pools: Arc::new(RwLock::new(HashMap::new())),
            routes_cache: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Add pool to graph
    pub fn add_pool(&self, pool: PoolState) {
        let mut pools = self.pools.write();
        pools.insert(pool.address.clone(), pool.clone());

        // Update graph
        let mut graph = self.graph.write();
        
        // Add edges: token0 -> token1 and token1 -> token0
        graph
            .entry(pool.token0.clone())
            .or_insert_with(Vec::new)
            .push((pool.address.clone(), pool.token1.clone()));

        graph
            .entry(pool.token1.clone())
            .or_insert_with(Vec::new)
            .push((pool.address.clone(), pool.token0.clone()));
    }

    /// Find all 2-hop routes (A -> B -> A)
    pub fn find_2hop_routes(&self) -> Vec<Route> {
        let graph = self.graph.read();
        let pools = self.pools.read();
        let mut routes = Vec::new();

        for (token_a, neighbors) in graph.iter() {
            for (pool1_addr, token_b) in neighbors {
                if let Some(neighbors_b) = graph.get(token_b) {
                    for (pool2_addr, token_c) in neighbors_b {
                        if token_c == token_a {
                            // Found: A -> B -> A
                            if let (Some(pool1), Some(pool2)) = (pools.get(pool1_addr), pools.get(pool2_addr)) {
                                let route = Route {
                                    id: format!("{}_{}_{}", token_a, token_b, token_c),
                                    path: vec![token_a.clone(), token_b.clone(), token_a.clone()],
                                    tokens: vec![token_a.clone(), token_b.clone()],
                                    hops: 2,
                                };
                                routes.push(route);
                            }
                        }
                    }
                }
            }
        }

        routes
    }

    /// Find all 3-hop routes (A -> B -> C -> A)
    pub fn find_3hop_routes(&self) -> Vec<Route> {
        let graph = self.graph.read();
        let pools = self.pools.read();
        let mut routes = Vec::new();

        for (token_a, neighbors_a) in graph.iter() {
            for (pool1_addr, token_b) in neighbors_a {
                if let Some(neighbors_b) = graph.get(token_b) {
                    for (pool2_addr, token_c) in neighbors_b {
                        if token_c != token_a {
                            if let Some(neighbors_c) = graph.get(token_c) {
                                for (pool3_addr, token_d) in neighbors_c {
                                    if token_d == token_a {
                                        // Found: A -> B -> C -> A
                                        if let (Some(_pool1), Some(_pool2), Some(_pool3)) = (
                                            pools.get(pool1_addr),
                                            pools.get(pool2_addr),
                                            pools.get(pool3_addr),
                                        ) {
                                            let route = Route {
                                                id: format!("{}_{}_{}_{}", token_a, token_b, token_c, token_d),
                                                path: vec![
                                                    token_a.clone(),
                                                    token_b.clone(),
                                                    token_c.clone(),
                                                    token_a.clone(),
                                                ],
                                                tokens: vec![token_a.clone(), token_b.clone(), token_c.clone()],
                                                hops: 3,
                                            };
                                            routes.push(route);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        routes
    }

    /// Get all routes (both 2-hop and 3-hop)
    pub fn get_all_routes(&self) -> Vec<Route> {
        let mut routes = self.find_2hop_routes();
        routes.extend(self.find_3hop_routes());
        routes
    }

    /// Calculate price ratio for a route
    pub fn calculate_route_price_ratio(&self, route: &Route) -> f64 {
        let pools = self.pools.read();
        let mut ratio = 1.0;

        for i in 0..route.hops {
            let token_in = &route.tokens[i];
            let token_out = &route.tokens[(i + 1) % route.tokens.len()];

            // Find pool connecting these tokens
            for pool in pools.values() {
                if (pool.token0 == *token_in && pool.token1 == *token_out)
                    || (pool.token0 == *token_out && pool.token1 == *token_in)
                {
                    // Calculate price: reserve_out / reserve_in
                    let price = if pool.token0 == *token_in {
                        pool.reserve1 as f64 / pool.reserve0 as f64
                    } else {
                        pool.reserve0 as f64 / pool.reserve1 as f64
                    };

                    ratio *= price;
                    break;
                }
            }
        }

        ratio
    }

    /// Detect profitable routes (ratio > 1.0 = profit)
    pub fn detect_profitable_routes(&self, min_profit_pct: f64) -> Vec<(Route, f64)> {
        let routes = self.get_all_routes();
        let mut profitable = Vec::new();

        for route in routes {
            let ratio = self.calculate_route_price_ratio(&route);
            let profit_pct = (ratio - 1.0) * 100.0;

            if profit_pct > min_profit_pct {
                profitable.push((route, ratio));
            }
        }

        profitable
    }

    /// Update cache
    pub fn update_cache(&self) {
        let routes = self.get_all_routes();
        let mut cache = self.routes_cache.write();
        *cache = routes;
    }

    /// Get cached routes
    pub fn get_cached_routes(&self) -> Vec<Route> {
        self.routes_cache.read().clone()
    }

    /// Get pool count
    pub fn pool_count(&self) -> usize {
        self.pools.read().len()
    }

    /// Get token count
    pub fn token_count(&self) -> usize {
        self.graph.read().len()
    }
}

impl Default for RouteGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_graph_2hop() {
        let graph = RouteGraph::new();

        // Add pools: USDC <-> WETH <-> DAI
        graph.add_pool(PoolState {
            address: "0x1".to_string(),
            token0: "USDC".to_string(),
            token1: "WETH".to_string(),
            reserve0: 1000000000000,
            reserve1: 500000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        });

        graph.add_pool(PoolState {
            address: "0x2".to_string(),
            token0: "WETH".to_string(),
            token1: "DAI".to_string(),
            reserve0: 500000000000000000000,
            reserve1: 1000000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        });

        let routes = graph.find_2hop_routes();
        assert!(!routes.is_empty());
    }

    #[test]
    fn test_route_price_ratio() {
        let graph = RouteGraph::new();

        graph.add_pool(PoolState {
            address: "0x1".to_string(),
            token0: "USDC".to_string(),
            token1: "WETH".to_string(),
            reserve0: 1000000000000,
            reserve1: 500000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        });

        graph.add_pool(PoolState {
            address: "0x2".to_string(),
            token0: "WETH".to_string(),
            token1: "USDC".to_string(),
            reserve0: 500000000000000000000,
            reserve1: 1000000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        });

        let routes = graph.find_2hop_routes();
        if !routes.is_empty() {
            let ratio = graph.calculate_route_price_ratio(&routes[0]);
            // Ratio should be close to 1.0 for balanced pools
            assert!(ratio > 0.9 && ratio < 1.1);
        }
    }
}
