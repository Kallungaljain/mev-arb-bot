use crate::types::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use chrono::{DateTime, Utc, Duration};

/// Pheromone: Chemical signal left by ants (traders) to mark profitable routes
#[derive(Clone, Debug)]
pub struct Pheromone {
    /// Route identifier (e.g., "USDC->USDT->DAI")
    pub route_id: String,
    /// Strength of pheromone (0.0-1.0, higher = more profitable)
    pub strength: f64,
    /// Timestamp when pheromone was deposited
    pub timestamp: DateTime<Utc>,
    /// Profit amount that triggered this pheromone
    pub profit_usd: f64,
    /// Number of successful trades on this route
    pub success_count: u32,
    /// Evaporation rate (pheromone fades over time)
    pub evaporation_rate: f64,
}

impl Pheromone {
    pub fn new(route_id: String, profit_usd: f64) -> Self {
        Pheromone {
            route_id,
            strength: (profit_usd / 1000.0).min(1.0), // Normalize profit to 0-1
            timestamp: Utc::now(),
            profit_usd,
            success_count: 1,
            evaporation_rate: 0.05, // 5% per minute
        }
    }

    /// Calculate current strength accounting for evaporation
    pub fn current_strength(&self) -> f64 {
        let age_minutes = (Utc::now() - self.timestamp).num_minutes() as f64;
        let decay_factor = (-self.evaporation_rate * age_minutes).exp();
        self.strength * decay_factor
    }

    /// Check if pheromone has completely evaporated
    pub fn is_evaporated(&self) -> bool {
        self.current_strength() < 0.01
    }

    /// Reinforce pheromone when same route is profitable again
    pub fn reinforce(&mut self, profit_usd: f64) {
        self.strength = (self.strength + (profit_usd / 1000.0)).min(1.0);
        self.timestamp = Utc::now();
        self.success_count += 1;
        self.profit_usd += profit_usd;
    }
}

/// Stigmergy: Decentralized coordination system via pheromones
/// Enables emergent route discovery without central planning
pub struct Stigmergy {
    /// Map of route_id -> Pheromone
    pheromones: Arc<Mutex<HashMap<String, Pheromone>>>,
    /// Global pheromone deposit rate
    deposit_rate: f64,
    /// Minimum profit to trigger pheromone deposit
    min_profit_threshold: f64,
    /// Maximum pheromones to track (prevents memory bloat)
    max_pheromones: usize,
}

impl Stigmergy {
    pub fn new(deposit_rate: f64, min_profit_threshold: f64) -> Self {
        Stigmergy {
            pheromones: Arc::new(Mutex::new(HashMap::new())),
            deposit_rate,
            min_profit_threshold,
            max_pheromones: 1000,
        }
    }

    /// Deposit pheromone when profitable route is found
    pub fn deposit_pheromone(&self, route_id: String, profit_usd: f64) {
        if profit_usd < self.min_profit_threshold {
            return; // Ignore unprofitable routes
        }

        let mut pheromones = self.pheromones.lock().unwrap();

        if let Some(existing) = pheromones.get_mut(&route_id) {
            // Reinforce existing pheromone
            existing.reinforce(profit_usd);
        } else {
            // Create new pheromone
            if pheromones.len() < self.max_pheromones {
                let new_pheromone = Pheromone::new(route_id.clone(), profit_usd);
                pheromones.insert(route_id, new_pheromone);
            }
        }
    }

    /// Get pheromone strength for a route (influences route selection)
    pub fn get_pheromone_strength(&self, route_id: &str) -> f64 {
        let pheromones = self.pheromones.lock().unwrap();
        pheromones
            .get(route_id)
            .map(|p| p.current_strength())
            .unwrap_or(0.0)
    }

    /// Get all active pheromones (routes with profitable history)
    pub fn get_active_routes(&self) -> Vec<(String, f64, u32)> {
        let pheromones = self.pheromones.lock().unwrap();
        pheromones
            .values()
            .filter(|p| !p.is_evaporated())
            .map(|p| (p.route_id.clone(), p.current_strength(), p.success_count))
            .collect()
    }

    /// Cleanup evaporated pheromones (memory management)
    pub fn cleanup_evaporated(&self) {
        let mut pheromones = self.pheromones.lock().unwrap();
        pheromones.retain(|_, p| !p.is_evaporated());
    }

    /// Get statistics about pheromone network
    pub fn get_statistics(&self) -> StigmergyStats {
        let pheromones = self.pheromones.lock().unwrap();
        let active_routes: Vec<_> = pheromones
            .values()
            .filter(|p| !p.is_evaporated())
            .collect();

        let total_profit: f64 = active_routes.iter().map(|p| p.profit_usd).sum();
        let total_trades: u32 = active_routes.iter().map(|p| p.success_count).sum();
        let avg_strength: f64 = if !active_routes.is_empty() {
            active_routes.iter().map(|p| p.current_strength()).sum::<f64>() / active_routes.len() as f64
        } else {
            0.0
        };

        StigmergyStats {
            total_routes: pheromones.len(),
            active_routes: active_routes.len(),
            total_profit,
            total_trades,
            avg_pheromone_strength: avg_strength,
        }
    }

    /// Influence route selection based on pheromone strength
    /// Higher pheromone = higher probability of selection
    pub fn select_route(&self, candidates: &[String]) -> Option<String> {
        if candidates.is_empty() {
            return None;
        }

        // Calculate weights based on pheromone strength
        let weights: Vec<f64> = candidates
            .iter()
            .map(|route| self.get_pheromone_strength(route) + 0.1) // +0.1 for exploration
            .collect();

        let total_weight: f64 = weights.iter().sum();
        if total_weight == 0.0 {
            return Some(candidates[0].clone());
        }

        // Roulette wheel selection
        let rng_value = (Utc::now().timestamp_millis() % 100) as f64 / 100.0;
        let mut cumulative = 0.0;

        for (i, weight) in weights.iter().enumerate() {
            cumulative += weight / total_weight;
            if rng_value <= cumulative {
                return Some(candidates[i].clone());
            }
        }

        Some(candidates[candidates.len() - 1].clone())
    }
}

/// Statistics about the pheromone network
#[derive(Clone, Debug)]
pub struct StigmergyStats {
    pub total_routes: usize,
    pub active_routes: usize,
    pub total_profit: f64,
    pub total_trades: u32,
    pub avg_pheromone_strength: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pheromone_creation() {
        let pheromone = Pheromone::new("USDC->USDT->DAI".to_string(), 500.0);
        assert_eq!(pheromone.route_id, "USDC->USDT->DAI");
        assert!(pheromone.strength > 0.0 && pheromone.strength <= 1.0);
        assert_eq!(pheromone.success_count, 1);
    }

    #[test]
    fn test_pheromone_reinforcement() {
        let mut pheromone = Pheromone::new("USDC->USDT->DAI".to_string(), 500.0);
        let initial_strength = pheromone.strength;
        pheromone.reinforce(300.0);
        assert!(pheromone.strength > initial_strength);
        assert_eq!(pheromone.success_count, 2);
    }

    #[test]
    fn test_stigmergy_deposit() {
        let stigmergy = Stigmergy::new(1.0, 100.0);
        stigmergy.deposit_pheromone("USDC->USDT->DAI".to_string(), 500.0);
        
        let strength = stigmergy.get_pheromone_strength("USDC->USDT->DAI");
        assert!(strength > 0.0);
    }

    #[test]
    fn test_stigmergy_ignores_low_profit() {
        let stigmergy = Stigmergy::new(1.0, 100.0);
        stigmergy.deposit_pheromone("USDC->USDT->DAI".to_string(), 50.0); // Below threshold
        
        let strength = stigmergy.get_pheromone_strength("USDC->USDT->DAI");
        assert_eq!(strength, 0.0);
    }

    #[test]
    fn test_route_selection() {
        let stigmergy = Stigmergy::new(1.0, 100.0);
        
        // Deposit pheromones
        stigmergy.deposit_pheromone("Route1".to_string(), 1000.0);
        stigmergy.deposit_pheromone("Route2".to_string(), 200.0);
        
        // Route1 should be selected more often (higher pheromone)
        let candidates = vec!["Route1".to_string(), "Route2".to_string()];
        let selected = stigmergy.select_route(&candidates);
        assert!(selected.is_some());
    }

    #[test]
    fn test_statistics() {
        let stigmergy = Stigmergy::new(1.0, 100.0);
        stigmergy.deposit_pheromone("Route1".to_string(), 500.0);
        stigmergy.deposit_pheromone("Route2".to_string(), 300.0);
        
        let stats = stigmergy.get_statistics();
        assert!(stats.total_routes > 0);
        assert!(stats.total_profit > 0.0);
    }
}
