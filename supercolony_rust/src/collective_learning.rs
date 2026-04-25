use crate::types::*;
use std::sync::Arc;
use dashmap::DashMap;
use parking_lot::RwLock;
use std::collections::HashMap;

/// Collective learning system for emergent intelligence
/// Workers learn from each other through pheromones and signals
pub struct CollectiveLearning {
    /// Route performance history
    route_performance: Arc<DashMap<String, RoutePerformance>>,
    
    /// Worker performance history
    worker_performance: Arc<DashMap<String, WorkerPerformance>>,
    
    /// Learned patterns
    patterns: Arc<RwLock<Vec<LearnedPattern>>>,
    
    /// Strategy recommendations
    strategies: Arc<RwLock<Vec<Strategy>>>,
}

#[derive(Clone, Debug)]
pub struct RoutePerformance {
    pub route_id: String,
    pub total_attempts: u64,
    pub successful_trades: u64,
    pub failed_trades: u64,
    pub total_profit: i128,
    pub average_profit: i128,
    pub last_updated: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub struct WorkerPerformance {
    pub worker_id: String,
    pub trades_executed: u64,
    pub success_rate: f64,
    pub total_profit: i128,
    pub average_latency_us: f64,
    pub last_updated: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub struct LearnedPattern {
    pub pattern_id: String,
    pub description: String,
    pub confidence: f64,
    pub discovered_by: Vec<String>, // worker IDs
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub struct Strategy {
    pub strategy_id: String,
    pub name: String,
    pub description: String,
    pub success_rate: f64,
    pub recommended_for: Vec<String>, // route types
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl CollectiveLearning {
    pub fn new() -> Self {
        Self {
            route_performance: Arc::new(DashMap::new()),
            worker_performance: Arc::new(DashMap::new()),
            patterns: Arc::new(RwLock::new(Vec::new())),
            strategies: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Record route performance
    pub fn record_route_performance(&self, route_id: String, success: bool, profit: i128) {
        let mut entry = self.route_performance
            .entry(route_id.clone())
            .or_insert_with(|| RoutePerformance {
                route_id: route_id.clone(),
                total_attempts: 0,
                successful_trades: 0,
                failed_trades: 0,
                total_profit: 0,
                average_profit: 0,
                last_updated: chrono::Utc::now(),
            });

        entry.total_attempts += 1;
        if success {
            entry.successful_trades += 1;
        } else {
            entry.failed_trades += 1;
        }
        entry.total_profit += profit;
        entry.average_profit = entry.total_profit / entry.total_attempts as i128;
        entry.last_updated = chrono::Utc::now();
    }

    /// Record worker performance
    pub fn record_worker_performance(
        &self,
        worker_id: String,
        success_rate: f64,
        profit: i128,
        latency_us: f64,
    ) {
        let mut entry = self.worker_performance
            .entry(worker_id.clone())
            .or_insert_with(|| WorkerPerformance {
                worker_id: worker_id.clone(),
                trades_executed: 0,
                success_rate,
                total_profit: 0,
                average_latency_us: latency_us,
                last_updated: chrono::Utc::now(),
            });

        entry.trades_executed += 1;
        entry.success_rate = success_rate;
        entry.total_profit += profit;
        entry.average_latency_us = latency_us;
        entry.last_updated = chrono::Utc::now();
    }

    /// Discover pattern from route performance
    pub fn discover_pattern(&self, pattern_id: String, description: String, worker_ids: Vec<String>) {
        let pattern = LearnedPattern {
            pattern_id,
            description,
            confidence: 0.8,
            discovered_by: worker_ids,
            timestamp: chrono::Utc::now(),
        };

        let mut patterns = self.patterns.write();
        patterns.push(pattern);
    }

    /// Recommend strategy based on learned patterns
    pub fn recommend_strategy(&self, strategy_id: String, name: String, success_rate: f64, routes: Vec<String>) {
        let strategy = Strategy {
            strategy_id,
            name,
            description: "Recommended strategy".to_string(),
            success_rate,
            recommended_for: routes,
            timestamp: chrono::Utc::now(),
        };

        let mut strategies = self.strategies.write();
        strategies.push(strategy);
    }

    /// Get route performance
    pub fn get_route_performance(&self, route_id: &str) -> Option<RoutePerformance> {
        self.route_performance.get(route_id).map(|entry| entry.clone())
    }

    /// Get worker performance
    pub fn get_worker_performance(&self, worker_id: &str) -> Option<WorkerPerformance> {
        self.worker_performance.get(worker_id).map(|entry| entry.clone())
    }

    /// Get best performing routes
    pub fn get_best_routes(&self, limit: usize) -> Vec<RoutePerformance> {
        let mut routes: Vec<_> = self.route_performance
            .iter()
            .map(|entry| entry.value().clone())
            .collect();

        routes.sort_by(|a, b| b.average_profit.cmp(&a.average_profit));
        routes.into_iter().take(limit).collect()
    }

    /// Get best performing workers
    pub fn get_best_workers(&self, limit: usize) -> Vec<WorkerPerformance> {
        let mut workers: Vec<_> = self.worker_performance
            .iter()
            .map(|entry| entry.value().clone())
            .collect();

        workers.sort_by(|a, b| b.success_rate.partial_cmp(&a.success_rate).unwrap());
        workers.into_iter().take(limit).collect()
    }

    /// Get discovered patterns
    pub fn get_patterns(&self) -> Vec<LearnedPattern> {
        self.patterns.read().clone()
    }

    /// Get recommended strategies
    pub fn get_strategies(&self) -> Vec<Strategy> {
        self.strategies.read().clone()
    }

    /// Calculate collective intelligence score
    pub fn calculate_intelligence_score(&self) -> f64 {
        let route_count = self.route_performance.len();
        let worker_count = self.worker_performance.len();
        let pattern_count = self.patterns.read().len();
        let strategy_count = self.strategies.read().len();

        // Score based on diversity and learning
        let diversity_score = ((route_count + worker_count) as f64).log2();
        let learning_score = ((pattern_count + strategy_count) as f64).log2();

        (diversity_score + learning_score) / 2.0
    }

    /// Get learning statistics
    pub fn get_statistics(&self) -> LearningStats {
        LearningStats {
            total_routes: self.route_performance.len(),
            total_workers: self.worker_performance.len(),
            total_patterns: self.patterns.read().len(),
            total_strategies: self.strategies.read().len(),
            collective_intelligence_score: self.calculate_intelligence_score(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct LearningStats {
    pub total_routes: usize,
    pub total_workers: usize,
    pub total_patterns: usize,
    pub total_strategies: usize,
    pub collective_intelligence_score: f64,
}

impl Default for CollectiveLearning {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_route_performance() {
        let learning = CollectiveLearning::new();
        learning.record_route_performance("route_1".to_string(), true, 1000);
        learning.record_route_performance("route_1".to_string(), true, 1500);

        let perf = learning.get_route_performance("route_1");
        assert!(perf.is_some());
        assert_eq!(perf.unwrap().total_attempts, 2);
    }

    #[test]
    fn test_discover_pattern() {
        let learning = CollectiveLearning::new();
        learning.discover_pattern(
            "pattern_1".to_string(),
            "High profit routes".to_string(),
            vec!["scout_1".to_string()],
        );

        let patterns = learning.get_patterns();
        assert_eq!(patterns.len(), 1);
    }

    #[test]
    fn test_best_routes() {
        let learning = CollectiveLearning::new();
        learning.record_route_performance("route_1".to_string(), true, 1000);
        learning.record_route_performance("route_2".to_string(), true, 2000);
        learning.record_route_performance("route_3".to_string(), true, 500);

        let best = learning.get_best_routes(2);
        assert_eq!(best.len(), 2);
        assert_eq!(best[0].route_id, "route_2");
    }

    #[test]
    fn test_intelligence_score() {
        let learning = CollectiveLearning::new();
        learning.record_route_performance("route_1".to_string(), true, 1000);
        learning.record_worker_performance("worker_1".to_string(), 0.95, 1000, 0.5);

        let score = learning.calculate_intelligence_score();
        assert!(score > 0.0);
    }
}
