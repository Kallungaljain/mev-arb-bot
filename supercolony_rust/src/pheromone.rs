use crate::types::*;
use dashmap::DashMap;
use std::sync::Arc;
use chrono::Utc;
use tokio::sync::broadcast;

/// Pheromone layer - the core of stigmergy
/// Workers modify the environment (pheromones) instead of communicating directly
pub struct PheromoneLayer {
    /// Active pheromones by route
    pheromones: Arc<DashMap<Id, Vec<Pheromone>>>,
    
    /// Broadcast channel for pheromone updates
    tx: broadcast::Sender<Pheromone>,
    
    /// Configuration
    config: SupercolonyConfig,
}

impl PheromoneLayer {
    pub fn new(config: SupercolonyConfig) -> Self {
        let (tx, _) = broadcast::channel(10000);
        
        Self {
            pheromones: Arc::new(DashMap::new()),
            tx,
            config,
        }
    }

    /// Scout deposits pheromone: "This route is profitable"
    pub async fn deposit_profitable_route(
        &self,
        route_id: Id,
        worker_id: Id,
        intensity: f64,
    ) -> Result<(), String> {
        let pheromone = Pheromone {
            signal_type: SignalType::ProfitableRoute,
            route_id: route_id.clone(),
            intensity: intensity.min(1.0).max(0.0),
            timestamp: Utc::now(),
            ttl_seconds: self.config.pheromone_ttl_seconds,
            source_worker: worker_id,
        };

        // Store in environment
        self.pheromones
            .entry(route_id.clone())
            .or_insert_with(Vec::new)
            .push(pheromone.clone());

        // Broadcast to all workers
        let _ = self.tx.send(pheromone);

        Ok(())
    }

    /// Scout deposits pheromone: "This route is no longer profitable"
    pub async fn deposit_unprofitable_route(
        &self,
        route_id: Id,
        worker_id: Id,
    ) -> Result<(), String> {
        let pheromone = Pheromone {
            signal_type: SignalType::UnprofitableRoute,
            route_id: route_id.clone(),
            intensity: 1.0,
            timestamp: Utc::now(),
            ttl_seconds: 60,  // Short TTL for decay
            source_worker: worker_id,
        };

        self.pheromones
            .entry(route_id.clone())
            .or_insert_with(Vec::new)
            .push(pheromone.clone());

        let _ = self.tx.send(pheromone);

        Ok(())
    }

    /// Defender deposits pheromone: "Danger detected"
    pub async fn deposit_danger_signal(
        &self,
        route_id: Id,
        worker_id: Id,
    ) -> Result<(), String> {
        let pheromone = Pheromone {
            signal_type: SignalType::DangerZone,
            route_id: route_id.clone(),
            intensity: 1.0,
            timestamp: Utc::now(),
            ttl_seconds: 30,  // Very short TTL for danger
            source_worker: worker_id,
        };

        self.pheromones
            .entry(route_id.clone())
            .or_insert_with(Vec::new)
            .push(pheromone.clone());

        let _ = self.tx.send(pheromone);

        Ok(())
    }

    /// Get pheromone intensity for a route
    /// This is how workers "read" the environment
    pub fn get_route_intensity(&self, route_id: &Id) -> f64 {
        if let Some(pheromones) = self.pheromones.get(route_id) {
            let now = Utc::now();
            
            let mut profitable_intensity = 0.0;
            let mut danger_intensity = 0.0;

            for pheromone in pheromones.iter() {
                // Check if pheromone is still active
                let age_seconds = (now - pheromone.timestamp).num_seconds() as u64;
                if age_seconds > pheromone.ttl_seconds {
                    continue;  // Pheromone has evaporated
                }

                // Calculate remaining intensity (evaporation)
                let remaining_ratio = 1.0 - (age_seconds as f64 / pheromone.ttl_seconds as f64);
                let current_intensity = pheromone.intensity * remaining_ratio;

                match pheromone.signal_type {
                    SignalType::ProfitableRoute => {
                        profitable_intensity = profitable_intensity.max(current_intensity);
                    }
                    SignalType::UnprofitableRoute => {
                        profitable_intensity = 0.0;  // Decay signal overrides
                    }
                    SignalType::DangerZone => {
                        danger_intensity = danger_intensity.max(current_intensity);
                    }
                    _ => {}
                }
            }

            // If danger is detected, reduce intensity
            if danger_intensity > 0.5 {
                profitable_intensity *= 0.1;  // 90% reduction in danger
            }

            profitable_intensity
        } else {
            0.0
        }
    }

    /// Get all active routes (those with pheromones)
    pub fn get_active_routes(&self) -> Vec<Id> {
        let now = Utc::now();
        let mut active = Vec::new();

        for entry in self.pheromones.iter() {
            let route_id = entry.key().clone();
            let pheromones = entry.value();

            // Check if any pheromone is still active
            let has_active = pheromones.iter().any(|p| {
                let age_seconds = (now - p.timestamp).num_seconds() as u64;
                age_seconds <= p.ttl_seconds
            });

            if has_active {
                active.push(route_id);
            }
        }

        active
    }

    /// Subscribe to pheromone updates
    pub fn subscribe(&self) -> broadcast::Receiver<Pheromone> {
        self.tx.subscribe()
    }

    /// Clean up expired pheromones (periodic maintenance)
    pub fn evaporate_expired(&self) {
        let now = Utc::now();

        for mut entry in self.pheromones.iter_mut() {
            entry.value_mut().retain(|p| {
                let age_seconds = (now - p.timestamp).num_seconds() as u64;
                age_seconds <= p.ttl_seconds
            });
        }

        // Remove empty entries
        self.pheromones.retain(|_, v| !v.is_empty());
    }

    /// Get pheromone statistics for monitoring
    pub fn get_statistics(&self) -> (usize, usize) {
        let total_routes = self.pheromones.len();
        let total_pheromones: usize = self.pheromones.iter().map(|e| e.value().len()).sum();
        (total_routes, total_pheromones)
    }
}

/// Stigmergy trait - defines how workers interact via pheromones
#[async_trait::async_trait]
pub trait StigmergicWorker: Send + Sync {
    /// Called when a pheromone is detected
    async fn on_pheromone(&self, pheromone: &Pheromone);

    /// Called periodically to update behavior based on environment
    async fn update_from_environment(&self, pheromone_layer: &PheromoneLayer);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pheromone_deposition() {
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

        let layer = PheromoneLayer::new(config);
        let route_id = "route_1".to_string();
        let worker_id = "worker_1".to_string();

        layer
            .deposit_profitable_route(route_id.clone(), worker_id, 0.8)
            .await
            .unwrap();

        let intensity = layer.get_route_intensity(&route_id);
        assert!(intensity > 0.7);
    }

    #[tokio::test]
    async fn test_pheromone_evaporation() {
        let config = SupercolonyConfig {
            alchemy_key: "test".to_string(),
            private_key: "test".to_string(),
            profit_address: "0x".to_string(),
            initial_capital: 1000000,
            max_workers: 10,
            pheromone_ttl_seconds: 1,  // 1 second TTL
            min_profit_threshold: 1000,
            gas_price_multiplier: 1.0,
        };

        let layer = PheromoneLayer::new(config);
        let route_id = "route_1".to_string();
        let worker_id = "worker_1".to_string();

        layer
            .deposit_profitable_route(route_id.clone(), worker_id, 0.8)
            .await
            .unwrap();

        // Immediately check
        let intensity_now = layer.get_route_intensity(&route_id);
        assert!(intensity_now > 0.7);

        // Wait for evaporation
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        let intensity_later = layer.get_route_intensity(&route_id);
        assert!(intensity_later < 0.1);
    }
}
