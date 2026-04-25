use crate::types::*;
use std::sync::Arc;
use dashmap::DashMap;
use parking_lot::RwLock;

/// Profit manager for tracking and reinvestment
pub struct ProfitManager {
    /// Total profit accumulated
    total_profit: Arc<RwLock<i128>>,
    
    /// Profit per worker
    worker_profits: Arc<DashMap<String, i128>>,
    
    /// Profit history
    history: Arc<RwLock<Vec<ProfitEvent>>>,
    
    /// Reinvestment strategy
    reinvestment_rate: f64, // 0.0 to 1.0
    
    /// Withdrawal address
    withdrawal_address: String,
}

#[derive(Clone, Debug)]
pub struct ProfitEvent {
    pub worker_id: String,
    pub amount: i128,
    pub event_type: ProfitEventType,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProfitEventType {
    Trade,
    Reinvestment,
    Withdrawal,
    Fee,
}

impl ProfitManager {
    pub fn new(withdrawal_address: String, reinvestment_rate: f64) -> Self {
        Self {
            total_profit: Arc::new(RwLock::new(0)),
            worker_profits: Arc::new(DashMap::new()),
            history: Arc::new(RwLock::new(Vec::new())),
            reinvestment_rate: reinvestment_rate.max(0.0).min(1.0),
            withdrawal_address,
        }
    }

    /// Record profit from a trade
    pub fn record_trade_profit(&self, worker_id: String, amount: i128) {
        // Update total profit
        let mut total = self.total_profit.write();
        *total += amount;

        // Update worker profit
        let mut worker_profit = self.worker_profits
            .entry(worker_id.clone())
            .or_insert(0);
        *worker_profit += amount;

        // Record event
        let event = ProfitEvent {
            worker_id,
            amount,
            event_type: ProfitEventType::Trade,
            timestamp: chrono::Utc::now(),
        };

        let mut history = self.history.write();
        history.push(event);
    }

    /// Calculate reinvestment amount
    pub fn calculate_reinvestment(&self) -> i128 {
        let total = *self.total_profit.read();
        if total > 0 {
            (total as f64 * self.reinvestment_rate) as i128
        } else {
            0
        }
    }

    /// Calculate withdrawal amount
    pub fn calculate_withdrawal(&self) -> i128 {
        let total = *self.total_profit.read();
        if total > 0 {
            (total as f64 * (1.0 - self.reinvestment_rate)) as i128
        } else {
            0
        }
    }

    /// Reinvest profit
    pub fn reinvest(&self, amount: i128) -> Result<(), String> {
        let mut total = self.total_profit.write();
        if amount > *total {
            return Err("Cannot reinvest more than total profit".to_string());
        }

        *total -= amount;

        // Record event
        let event = ProfitEvent {
            worker_id: "system".to_string(),
            amount,
            event_type: ProfitEventType::Reinvestment,
            timestamp: chrono::Utc::now(),
        };

        let mut history = self.history.write();
        history.push(event);

        Ok(())
    }

    /// Withdraw profit
    pub fn withdraw(&self, amount: i128) -> Result<(), String> {
        let mut total = self.total_profit.write();
        if amount > *total {
            return Err("Cannot withdraw more than total profit".to_string());
        }

        *total -= amount;

        // Record event
        let event = ProfitEvent {
            worker_id: self.withdrawal_address.clone(),
            amount,
            event_type: ProfitEventType::Withdrawal,
            timestamp: chrono::Utc::now(),
        };

        let mut history = self.history.write();
        history.push(event);

        Ok(())
    }

    /// Deduct fee
    pub fn deduct_fee(&self, amount: i128) -> Result<(), String> {
        let mut total = self.total_profit.write();
        if amount > *total {
            return Err("Cannot deduct more than total profit".to_string());
        }

        *total -= amount;

        // Record event
        let event = ProfitEvent {
            worker_id: "fee".to_string(),
            amount,
            event_type: ProfitEventType::Fee,
            timestamp: chrono::Utc::now(),
        };

        let mut history = self.history.write();
        history.push(event);

        Ok(())
    }

    /// Get total profit
    pub fn get_total_profit(&self) -> i128 {
        *self.total_profit.read()
    }

    /// Get worker profit
    pub fn get_worker_profit(&self, worker_id: &str) -> Option<i128> {
        self.worker_profits.get(worker_id).map(|entry| *entry)
    }

    /// Get all worker profits
    pub fn get_all_worker_profits(&self) -> Vec<(String, i128)> {
        self.worker_profits
            .iter()
            .map(|entry| (entry.key().clone(), *entry.value()))
            .collect()
    }

    /// Get profit history
    pub fn get_history(&self) -> Vec<ProfitEvent> {
        self.history.read().clone()
    }

    /// Get profit statistics
    pub fn get_statistics(&self) -> ProfitStats {
        let total_profit = *self.total_profit.read();
        let history = self.history.read();

        let mut trade_profit = 0i128;
        let mut reinvestment_amount = 0i128;
        let mut withdrawal_amount = 0i128;
        let mut fee_amount = 0i128;
        let mut trade_count = 0u64;

        for event in history.iter() {
            match event.event_type {
                ProfitEventType::Trade => {
                    trade_profit += event.amount;
                    trade_count += 1;
                }
                ProfitEventType::Reinvestment => {
                    reinvestment_amount += event.amount;
                }
                ProfitEventType::Withdrawal => {
                    withdrawal_amount += event.amount;
                }
                ProfitEventType::Fee => {
                    fee_amount += event.amount;
                }
            }
        }

        let average_profit_per_trade = if trade_count > 0 {
            trade_profit / trade_count as i128
        } else {
            0
        };

        ProfitStats {
            total_profit,
            trade_profit,
            reinvestment_amount,
            withdrawal_amount,
            fee_amount,
            trade_count,
            average_profit_per_trade,
            reinvestment_rate: self.reinvestment_rate,
        }
    }

    /// Get top performing workers
    pub fn get_top_workers(&self, limit: usize) -> Vec<(String, i128)> {
        let mut workers: Vec<_> = self.worker_profits
            .iter()
            .map(|entry| (entry.key().clone(), *entry.value()))
            .collect();

        workers.sort_by(|a, b| b.1.cmp(&a.1));
        workers.into_iter().take(limit).collect()
    }
}

#[derive(Clone, Debug)]
pub struct ProfitStats {
    pub total_profit: i128,
    pub trade_profit: i128,
    pub reinvestment_amount: i128,
    pub withdrawal_amount: i128,
    pub fee_amount: i128,
    pub trade_count: u64,
    pub average_profit_per_trade: i128,
    pub reinvestment_rate: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_trade_profit() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);

        let total = manager.get_total_profit();
        assert_eq!(total, 1000);
    }

    #[test]
    fn test_calculate_reinvestment() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);

        let reinvestment = manager.calculate_reinvestment();
        assert_eq!(reinvestment, 800);
    }

    #[test]
    fn test_calculate_withdrawal() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);

        let withdrawal = manager.calculate_withdrawal();
        assert_eq!(withdrawal, 200);
    }

    #[test]
    fn test_reinvest() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);
        let result = manager.reinvest(800);

        assert!(result.is_ok());
        let total = manager.get_total_profit();
        assert_eq!(total, 200);
    }

    #[test]
    fn test_withdraw() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);
        let result = manager.withdraw(200);

        assert!(result.is_ok());
        let total = manager.get_total_profit();
        assert_eq!(total, 800);
    }

    #[test]
    fn test_profit_statistics() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);
        manager.record_trade_profit("worker_2".to_string(), 1500);

        let stats = manager.get_statistics();
        assert_eq!(stats.total_profit, 2500);
        assert_eq!(stats.trade_count, 2);
        assert_eq!(stats.average_profit_per_trade, 1250);
    }

    #[test]
    fn test_top_workers() {
        let manager = ProfitManager::new("0x1234".to_string(), 0.8);
        manager.record_trade_profit("worker_1".to_string(), 1000);
        manager.record_trade_profit("worker_2".to_string(), 2000);
        manager.record_trade_profit("worker_3".to_string(), 500);

        let top = manager.get_top_workers(2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, "worker_2");
    }
}
