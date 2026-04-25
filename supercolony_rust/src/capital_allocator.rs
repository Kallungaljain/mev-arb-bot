use crate::types::*;
use std::sync::Arc;
use dashmap::DashMap;
use parking_lot::RwLock;

/// Adaptive capital allocator for dynamic fund distribution
/// Allocates capital to workers based on performance and pheromone signals
pub struct CapitalAllocator {
    /// Total capital available
    total_capital: Arc<RwLock<u128>>,
    
    /// Capital allocated to each worker
    allocations: Arc<DashMap<String, u128>>,
    
    /// Capital in use (locked for trades)
    in_use: Arc<RwLock<u128>>,
    
    /// Worker performance scores
    performance_scores: Arc<DashMap<String, f64>>,
    
    /// Allocation history
    history: Arc<RwLock<Vec<AllocationEvent>>>,
}

#[derive(Clone, Debug)]
pub struct AllocationEvent {
    pub worker_id: String,
    pub amount: u128,
    pub reason: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl CapitalAllocator {
    pub fn new(total_capital: u128) -> Self {
        Self {
            total_capital: Arc::new(RwLock::new(total_capital)),
            allocations: Arc::new(DashMap::new()),
            in_use: Arc::new(RwLock::new(0)),
            performance_scores: Arc::new(DashMap::new()),
            history: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Allocate capital to a worker
    pub fn allocate(&self, worker_id: String, amount: u128) -> Result<(), String> {
        let total = *self.total_capital.read();
        let in_use = *self.in_use.read();
        let available = total - in_use;

        if amount > available {
            return Err(format!(
                "Insufficient capital: requested {}, available {}",
                amount, available
            ));
        }

        self.allocations.insert(worker_id.clone(), amount);

        let mut in_use_guard = self.in_use.write();
        *in_use_guard += amount;

        // Record event
        let event = AllocationEvent {
            worker_id,
            amount,
            reason: "Initial allocation".to_string(),
            timestamp: chrono::Utc::now(),
        };

        let mut history = self.history.write();
        history.push(event);

        Ok(())
    }

    /// Release capital from a worker
    pub fn release(&self, worker_id: &str, amount: u128) -> Result<(), String> {
        if let Some((_, current)) = self.allocations.remove(worker_id) {
            if amount > current {
                // Re-insert the original amount
                self.allocations.insert(worker_id.to_string(), current);
                return Err(format!(
                    "Cannot release {} from allocation of {}",
                    amount, current
                ));
            }

            let remaining = current - amount;
            if remaining > 0 {
                self.allocations.insert(worker_id.to_string(), remaining);
            }

            let mut in_use_guard = self.in_use.write();
            *in_use_guard -= amount;

            Ok(())
        } else {
            Err(format!("Worker {} not found", worker_id))
        }
    }

    /// Rebalance capital based on performance
    pub fn rebalance(&self, performance_data: Vec<(String, f64)>) -> Result<(), String> {
        // Calculate total performance score
        let total_score: f64 = performance_data.iter().map(|(_, score)| score).sum();

        if total_score == 0.0 {
            return Err("No performance data".to_string());
        }

        let total_capital = *self.total_capital.read();

        // Allocate capital proportionally to performance
        for (worker_id, score) in performance_data {
            let allocation = (total_capital as f64 * (score / total_score)) as u128;

            // Release old allocation
            if let Some((_, old_allocation)) = self.allocations.remove(&worker_id) {
                let mut in_use_guard = self.in_use.write();
                *in_use_guard -= old_allocation;
            }

            // Allocate new amount
            self.allocations.insert(worker_id.clone(), allocation);

            let mut in_use_guard = self.in_use.write();
            *in_use_guard += allocation;

            // Record event
            let event = AllocationEvent {
                worker_id,
                amount: allocation,
                reason: "Rebalance based on performance".to_string(),
                timestamp: chrono::Utc::now(),
            };

            let mut history = self.history.write();
            history.push(event);
        }

        Ok(())
    }

    /// Allocate based on pheromone intensity
    pub fn allocate_by_pheromone(&self, worker_id: String, pheromone_intensity: f64) -> Result<(), String> {
        let total_capital = *self.total_capital.read();
        
        // Allocate proportionally to pheromone intensity
        let allocation = (total_capital as f64 * pheromone_intensity) as u128;

        self.allocate(worker_id.clone(), allocation)?;

        // Record event
        let event = AllocationEvent {
            worker_id,
            amount: allocation,
            reason: format!("Pheromone-based allocation (intensity: {})", pheromone_intensity),
            timestamp: chrono::Utc::now(),
        };

        let mut history = self.history.write();
        history.push(event);

        Ok(())
    }

    /// Get allocation for a worker
    pub fn get_allocation(&self, worker_id: &str) -> Option<u128> {
        self.allocations.get(worker_id).map(|entry| *entry)
    }

    /// Get total allocated capital
    pub fn get_total_allocated(&self) -> u128 {
        *self.in_use.read()
    }

    /// Get available capital
    pub fn get_available(&self) -> u128 {
        let total = *self.total_capital.read();
        let in_use = *self.in_use.read();
        total - in_use
    }

    /// Get all allocations
    pub fn get_all_allocations(&self) -> Vec<(String, u128)> {
        self.allocations
            .iter()
            .map(|entry| (entry.key().clone(), *entry.value()))
            .collect()
    }

    /// Update performance score
    pub fn update_performance_score(&self, worker_id: String, score: f64) {
        self.performance_scores.insert(worker_id, score);
    }

    /// Get performance score
    pub fn get_performance_score(&self, worker_id: &str) -> Option<f64> {
        self.performance_scores.get(worker_id).map(|entry| *entry)
    }

    /// Get allocation history
    pub fn get_history(&self) -> Vec<AllocationEvent> {
        self.history.read().clone()
    }

    /// Get capital statistics
    pub fn get_statistics(&self) -> CapitalStats {
        let total = *self.total_capital.read();
        let in_use = *self.in_use.read();
        let available = total - in_use;
        let worker_count = self.allocations.len();

        CapitalStats {
            total_capital: total,
            allocated_capital: in_use,
            available_capital: available,
            allocation_percentage: if total > 0 {
                (in_use as f64 / total as f64) * 100.0
            } else {
                0.0
            },
            worker_count,
            average_allocation_per_worker: if worker_count > 0 {
                in_use / worker_count as u128
            } else {
                0
            },
        }
    }

    /// Increase total capital
    pub fn increase_capital(&self, amount: u128) {
        let mut total = self.total_capital.write();
        *total += amount;
    }

    /// Decrease total capital
    pub fn decrease_capital(&self, amount: u128) -> Result<(), String> {
        let mut total = self.total_capital.write();
        if amount > *total {
            return Err("Cannot decrease capital below 0".to_string());
        }
        *total -= amount;
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct CapitalStats {
    pub total_capital: u128,
    pub allocated_capital: u128,
    pub available_capital: u128,
    pub allocation_percentage: f64,
    pub worker_count: usize,
    pub average_allocation_per_worker: u128,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allocate_capital() {
        let allocator = CapitalAllocator::new(1000000);
        let result = allocator.allocate("worker_1".to_string(), 100000);
        assert!(result.is_ok());

        let allocation = allocator.get_allocation("worker_1");
        assert_eq!(allocation, Some(100000));
    }

    #[test]
    fn test_insufficient_capital() {
        let allocator = CapitalAllocator::new(100000);
        let result = allocator.allocate("worker_1".to_string(), 200000);
        assert!(result.is_err());
    }

    #[test]
    fn test_release_capital() {
        let allocator = CapitalAllocator::new(1000000);
        allocator.allocate("worker_1".to_string(), 100000).ok();
        let result = allocator.release("worker_1", 50000);
        assert!(result.is_ok());

        let allocation = allocator.get_allocation("worker_1");
        assert_eq!(allocation, Some(50000));
    }

    #[test]
    fn test_rebalance() {
        let allocator = CapitalAllocator::new(1000000);
        let performance_data = vec![
            ("worker_1".to_string(), 0.7),
            ("worker_2".to_string(), 0.3),
        ];

        let result = allocator.rebalance(performance_data);
        assert!(result.is_ok());

        let stats = allocator.get_statistics();
        assert_eq!(stats.worker_count, 2);
    }

    #[test]
    fn test_pheromone_allocation() {
        let allocator = CapitalAllocator::new(1000000);
        let result = allocator.allocate_by_pheromone("worker_1".to_string(), 0.5);
        assert!(result.is_ok());

        let allocation = allocator.get_allocation("worker_1");
        assert_eq!(allocation, Some(500000));
    }

    #[test]
    fn test_capital_statistics() {
        let allocator = CapitalAllocator::new(1000000);
        allocator.allocate("worker_1".to_string(), 100000).ok();
        allocator.allocate("worker_2".to_string(), 200000).ok();

        let stats = allocator.get_statistics();
        assert_eq!(stats.total_capital, 1000000);
        assert_eq!(stats.allocated_capital, 300000);
        assert_eq!(stats.available_capital, 700000);
        assert_eq!(stats.worker_count, 2);
    }
}
