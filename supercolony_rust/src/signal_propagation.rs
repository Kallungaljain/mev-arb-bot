use crate::types::*;
use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::broadcast;
use std::collections::VecDeque;

/// Signal propagation system for stigmergic communication
/// Workers broadcast signals that others listen to
pub struct SignalPropagation {
    /// Broadcast channels for each signal type
    profitable_route_tx: broadcast::Sender<(String, f64)>,
    danger_zone_tx: broadcast::Sender<String>,
    opportunity_tx: broadcast::Sender<Opportunity>,
    
    /// Signal history for learning
    history: Arc<DashMap<String, VecDeque<SignalEvent>>>,
    
    /// Signal statistics
    stats: Arc<DashMap<String, SignalStats>>,
}

#[derive(Clone, Debug)]
pub struct SignalEvent {
    pub signal_type: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub source: String,
    pub data: String,
}

#[derive(Clone, Debug, Default)]
pub struct SignalStats {
    pub total_signals: u64,
    pub last_signal_time: Option<chrono::DateTime<chrono::Utc>>,
    pub signal_count_per_second: f64,
}

impl SignalPropagation {
    pub fn new() -> Self {
        let (profitable_route_tx, _) = broadcast::channel(1000);
        let (danger_zone_tx, _) = broadcast::channel(1000);
        let (opportunity_tx, _) = broadcast::channel(1000);

        Self {
            profitable_route_tx,
            danger_zone_tx,
            opportunity_tx,
            history: Arc::new(DashMap::new()),
            stats: Arc::new(DashMap::new()),
        }
    }

    /// Broadcast profitable route signal
    pub fn broadcast_profitable_route(&self, route_id: String, intensity: f64) -> Result<(), String> {
        self.profitable_route_tx
            .send((route_id.clone(), intensity))
            .map_err(|_| "Failed to broadcast profitable route".to_string())?;

        self.record_signal("profitable_route", &route_id, "system");
        Ok(())
    }

    /// Broadcast danger zone signal
    pub fn broadcast_danger_zone(&self, route_id: String) -> Result<(), String> {
        self.danger_zone_tx
            .send(route_id.clone())
            .map_err(|_| "Failed to broadcast danger zone".to_string())?;

        self.record_signal("danger_zone", &route_id, "system");
        Ok(())
    }

    /// Broadcast opportunity signal
    pub fn broadcast_opportunity(&self, opportunity: Opportunity) -> Result<(), String> {
        self.opportunity_tx
            .send(opportunity.clone())
            .map_err(|_| "Failed to broadcast opportunity".to_string())?;

        self.record_signal("opportunity", &opportunity.id, "system");
        Ok(())
    }

    /// Subscribe to profitable route signals
    pub fn subscribe_to_profitable_routes(&self) -> broadcast::Receiver<(String, f64)> {
        self.profitable_route_tx.subscribe()
    }

    /// Subscribe to danger zone signals
    pub fn subscribe_to_danger_zones(&self) -> broadcast::Receiver<String> {
        self.danger_zone_tx.subscribe()
    }

    /// Subscribe to opportunity signals
    pub fn subscribe_to_opportunities(&self) -> broadcast::Receiver<Opportunity> {
        self.opportunity_tx.subscribe()
    }

    /// Record signal in history
    fn record_signal(&self, signal_type: &str, data: &str, source: &str) {
        let event = SignalEvent {
            signal_type: signal_type.to_string(),
            timestamp: chrono::Utc::now(),
            source: source.to_string(),
            data: data.to_string(),
        };

        let mut history = self.history
            .entry(signal_type.to_string())
            .or_insert_with(VecDeque::new);

        history.push_back(event);

        // Keep only last 1000 signals per type
        if history.len() > 1000 {
            history.pop_front();
        }

        // Update stats
        let mut stats = self.stats
            .entry(signal_type.to_string())
            .or_insert_with(SignalStats::default);

        stats.total_signals += 1;
        stats.last_signal_time = Some(chrono::Utc::now());
    }

    /// Get signal history for a type
    pub fn get_history(&self, signal_type: &str) -> Vec<SignalEvent> {
        self.history
            .get(signal_type)
            .map(|entry| entry.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get signal statistics
    pub fn get_stats(&self, signal_type: &str) -> Option<SignalStats> {
        self.stats.get(signal_type).map(|entry| entry.clone())
    }

    /// Get all signal types
    pub fn get_all_signal_types(&self) -> Vec<String> {
        self.stats
            .iter()
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// Get total signals across all types
    pub fn get_total_signals(&self) -> u64 {
        self.stats
            .iter()
            .map(|entry| entry.value().total_signals)
            .sum()
    }

    /// Clear history (for testing)
    pub fn clear_history(&self) {
        self.history.clear();
    }
}

impl Default for SignalPropagation {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_broadcast_profitable_route() {
        let propagation = SignalPropagation::new();
        let result = propagation.broadcast_profitable_route("route_1".to_string(), 0.8);
        assert!(result.is_ok());
    }

    #[test]
    fn test_subscribe_to_signals() {
        let propagation = SignalPropagation::new();
        let _rx = propagation.subscribe_to_profitable_routes();
        let result = propagation.broadcast_profitable_route("route_1".to_string(), 0.8);
        assert!(result.is_ok());
    }

    #[test]
    fn test_signal_history() {
        let propagation = SignalPropagation::new();
        propagation.broadcast_profitable_route("route_1".to_string(), 0.8).ok();
        propagation.broadcast_profitable_route("route_2".to_string(), 0.6).ok();

        let history = propagation.get_history("profitable_route");
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn test_signal_statistics() {
        let propagation = SignalPropagation::new();
        propagation.broadcast_profitable_route("route_1".to_string(), 0.8).ok();
        propagation.broadcast_profitable_route("route_2".to_string(), 0.6).ok();

        let stats = propagation.get_stats("profitable_route");
        assert!(stats.is_some());
        assert_eq!(stats.unwrap().total_signals, 2);
    }

    #[test]
    fn test_danger_zone_broadcast() {
        let propagation = SignalPropagation::new();
        let result = propagation.broadcast_danger_zone("route_1".to_string());
        assert!(result.is_ok());

        let history = propagation.get_history("danger_zone");
        assert_eq!(history.len(), 1);
    }
}
