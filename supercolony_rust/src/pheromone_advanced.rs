use crate::types::*;
use std::sync::Arc;
use dashmap::DashMap;
use parking_lot::RwLock;
use chrono::{DateTime, Utc, Duration};

/// Advanced pheromone layer with decay, evaporation, and signal propagation
pub struct AdvancedPheromoneLayer {
    /// Active pheromones: route_id -> (intensity, depositor, timestamp)
    pheromones: Arc<DashMap<String, (f64, String, DateTime<Utc>)>>,
    
    /// Pheromone history for learning
    history: Arc<RwLock<Vec<PheromoneEvent>>>,
    
    /// Configuration
    config: SupercolonyConfig,
    
    /// Statistics
    stats: Arc<RwLock<PheromoneStats>>,
}

#[derive(Clone, Debug)]
pub struct PheromoneEvent {
    pub route_id: String,
    pub signal_type: SignalType,
    pub intensity: f64,
    pub depositor: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Clone, Debug, Default)]
pub struct PheromoneStats {
    pub total_deposits: u64,
    pub total_evaporations: u64,
    pub active_pheromones: usize,
    pub avg_intensity: f64,
    pub max_intensity: f64,
}

impl AdvancedPheromoneLayer {
    pub fn new(config: SupercolonyConfig) -> Self {
        Self {
            pheromones: Arc::new(DashMap::new()),
            history: Arc::new(RwLock::new(Vec::new())),
            config,
            stats: Arc::new(RwLock::new(PheromoneStats::default())),
        }
    }

    /// Deposit pheromone with intensity
    pub async fn deposit(&self, route_id: String, depositor: String, intensity: f64) {
        let now = Utc::now();
        
        // Update or insert pheromone
        self.pheromones.insert(route_id.clone(), (intensity, depositor.clone(), now));

        // Record event
        let event = PheromoneEvent {
            route_id,
            signal_type: SignalType::ProfitableRoute,
            intensity,
            depositor,
            timestamp: now,
        };

        let mut history = self.history.write();
        history.push(event);

        // Update stats
        let mut stats = self.stats.write();
        stats.total_deposits += 1;
        stats.active_pheromones = self.pheromones.len();
        stats.max_intensity = stats.max_intensity.max(intensity);
    }

    /// Deposit danger signal
    pub async fn deposit_danger(&self, route_id: String, depositor: String) {
        let now = Utc::now();
        
        // Danger signal: negative intensity
        self.pheromones.insert(route_id.clone(), (-1.0, depositor.clone(), now));

        let event = PheromoneEvent {
            route_id,
            signal_type: SignalType::DangerZone,
            intensity: -1.0,
            depositor,
            timestamp: now,
        };

        let mut history = self.history.write();
        history.push(event);

        let mut stats = self.stats.write();
        stats.total_deposits += 1;
    }

    /// Get pheromone intensity for a route
    pub fn get_intensity(&self, route_id: &str) -> f64 {
        self.pheromones
            .get(route_id)
            .map(|entry| entry.0)
            .unwrap_or(0.0)
    }

    /// Evaporate expired pheromones (TTL-based)
    pub fn evaporate(&self) {
        let now = Utc::now();
        let ttl = Duration::seconds(self.config.pheromone_ttl_seconds as i64);

        let mut to_remove = Vec::new();

        for entry in self.pheromones.iter() {
            let (_, _, timestamp) = entry.value();
            if now.signed_duration_since(*timestamp) > ttl {
                to_remove.push(entry.key().clone());
            }
        }

        for route_id in to_remove {
            self.pheromones.remove(&route_id);

            let mut stats = self.stats.write();
            stats.total_evaporations += 1;
            stats.active_pheromones = self.pheromones.len();
        }
    }

    /// Decay pheromones over time (gradual reduction)
    pub fn decay(&self) {
        const DECAY_RATE: f64 = 0.95; // 5% decay per cycle

        for mut entry in self.pheromones.iter_mut() {
            let (intensity, depositor, timestamp) = entry.value_mut();
            if *intensity > 0.0 {
                *intensity *= DECAY_RATE;
            }
        }
    }

    /// Get all active routes
    pub fn get_active_routes(&self) -> Vec<String> {
        self.pheromones
            .iter()
            .filter(|entry| entry.value().0 > 0.0)
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// Get all danger zones
    pub fn get_danger_zones(&self) -> Vec<String> {
        self.pheromones
            .iter()
            .filter(|entry| entry.value().0 < 0.0)
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// Get pheromone statistics
    pub fn get_stats(&self) -> PheromoneStats {
        let mut stats = self.stats.write();
        
        // Calculate average intensity
        let mut total_intensity = 0.0;
        let mut count = 0;
        for entry in self.pheromones.iter() {
            if entry.value().0 > 0.0 {
                total_intensity += entry.value().0;
                count += 1;
            }
        }
        
        stats.avg_intensity = if count > 0 {
            total_intensity / count as f64
        } else {
            0.0
        };
        
        stats.active_pheromones = self.pheromones.len();
        stats.clone()
    }

    /// Get pheromone history
    pub fn get_history(&self) -> Vec<PheromoneEvent> {
        self.history.read().clone()
    }

    /// Find most profitable route (highest intensity)
    pub fn find_best_route(&self) -> Option<(String, f64)> {
        self.pheromones
            .iter()
            .filter(|entry| entry.value().0 > 0.0)
            .max_by(|a, b| a.value().0.partial_cmp(&b.value().0).unwrap())
            .map(|entry| (entry.key().clone(), entry.value().0))
    }

    /// Get routes sorted by intensity
    pub fn get_routes_by_intensity(&self) -> Vec<(String, f64)> {
        let mut routes: Vec<_> = self.pheromones
            .iter()
            .filter(|entry| entry.value().0 > 0.0)
            .map(|entry| (entry.key().clone(), entry.value().0))
            .collect();

        routes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        routes
    }

    /// Broadcast pheromone to all workers (simulated)
    pub async fn broadcast(&self, route_id: &str) -> Result<(), String> {
        let intensity = self.get_intensity(route_id);
        if intensity > 0.0 {
            // In production, this would broadcast to Redis pub/sub
            Ok(())
        } else {
            Err("Route not found or expired".to_string())
        }
    }

    /// Merge pheromones from multiple scouts
    pub fn merge_pheromones(&self, other: &AdvancedPheromoneLayer) {
        for entry in other.pheromones.iter() {
            let (route_id, (intensity, depositor, timestamp)) = (entry.key().clone(), entry.value().clone());
            
            // Take the maximum intensity
            if let Some(mut existing) = self.pheromones.get_mut(&route_id) {
                if intensity > existing.0 {
                    *existing = (intensity, depositor, timestamp);
                }
            } else {
                self.pheromones.insert(route_id, (intensity, depositor, timestamp));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pheromone_deposit_and_intensity() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let layer = AdvancedPheromoneLayer::new(config);
        layer.deposit("route_1".to_string(), "scout_1".to_string(), 0.8).await;

        let intensity = layer.get_intensity("route_1");
        assert_eq!(intensity, 0.8);
    }

    #[test]
    fn test_pheromone_decay() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let layer = AdvancedPheromoneLayer::new(config);
        
        // Manually insert for testing
        layer.pheromones.insert("route_1".to_string(), (1.0, "scout_1".to_string(), Utc::now()));
        
        layer.decay();
        let intensity = layer.get_intensity("route_1");
        assert!(intensity < 1.0 && intensity > 0.9);
    }

    #[test]
    fn test_danger_zone() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let layer = AdvancedPheromoneLayer::new(config);
        layer.pheromones.insert("route_1".to_string(), (-1.0, "scout_1".to_string(), Utc::now()));

        let danger_zones = layer.get_danger_zones();
        assert!(danger_zones.contains(&"route_1".to_string()));
    }

    #[test]
    fn test_best_route_selection() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 300,
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let layer = AdvancedPheromoneLayer::new(config);
        layer.pheromones.insert("route_1".to_string(), (0.5, "scout_1".to_string(), Utc::now()));
        layer.pheromones.insert("route_2".to_string(), (0.8, "scout_2".to_string(), Utc::now()));
        layer.pheromones.insert("route_3".to_string(), (0.3, "scout_3".to_string(), Utc::now()));

        let best = layer.find_best_route();
        assert_eq!(best, Some(("route_2".to_string(), 0.8)));
    }
}
