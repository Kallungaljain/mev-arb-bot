use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use chrono::{DateTime, Utc};

/// Unique identifier for routes, workers, opportunities
pub type Id = String;

/// Timestamp for all events
pub type Timestamp = DateTime<Utc>;

/// Pool state from blockchain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolState {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub reserve0: u128,
    pub reserve1: u128,
    pub fee: u32,
    pub updated_at: Timestamp,
}

/// Route discovered by scouts (path of pools)
#[derive(Debug, Clone, Serialize, Deserialize, Hash, Eq, PartialEq)]
pub struct Route {
    pub id: Id,
    pub path: Vec<String>,  // Pool addresses
    pub tokens: Vec<String>,  // Token path
    pub hops: usize,
}

/// Pheromone signal - the core of stigmergy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pheromone {
    pub signal_type: SignalType,
    pub route_id: Id,
    pub intensity: f64,  // 0.0 - 1.0
    pub timestamp: Timestamp,
    pub ttl_seconds: u64,
    pub source_worker: Id,
}

/// Types of pheromone signals
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SignalType {
    /// "This route is profitable" - scouts broadcast this
    ProfitableRoute,
    /// "This route is no longer profitable" - decay signal
    UnprofitableRoute,
    /// "Danger: sandwich attack detected" - warning signal
    DangerZone,
    /// "Capital allocation needed" - executor signal
    NeedCapital,
    /// "Capital available" - queen signal
    CapitalAvailable,
}

/// Opportunity detected on a route
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opportunity {
    pub id: Id,
    pub route: Route,
    pub amount_in: u128,
    pub expected_profit: i128,
    pub profit_percentage: f64,
    pub detected_at: Timestamp,
    pub gas_estimate: u64,
}

/// Transaction to execute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: Id,
    pub opportunity_id: Id,
    pub to: String,
    pub data: String,
    pub gas_limit: u64,
    pub gas_price: u128,
    pub value: u128,
    pub nonce: String,
}

/// Signed transaction ready for submission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedTransaction {
    pub id: Id,
    pub tx_id: Id,
    pub raw_tx: String,
    pub signature: String,
    pub signed_at: Timestamp,
}

/// Result of transaction execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub tx_hash: String,
    pub success: bool,
    pub gas_used: u64,
    pub profit_loss: i128,
    pub error: Option<String>,
    pub executed_at: Timestamp,
}

/// Worker state and metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerMetrics {
    pub worker_id: Id,
    pub worker_type: WorkerType,
    pub routes_discovered: usize,
    pub opportunities_found: usize,
    pub trades_executed: usize,
    pub successful_trades: usize,
    pub total_profit: i128,
    pub average_latency_us: f64,
    pub p99_latency_us: f64,
    pub last_activity: Timestamp,
}

/// Types of workers in the supercolony
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum WorkerType {
    Scout,    // Discovers routes
    Executor, // Executes trades
    Defender, // Monitors for danger
}

/// Capital allocation state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapitalAllocation {
    pub total_capital: u128,
    pub allocated: HashMap<Id, u128>,  // worker_id -> amount
    pub available: u128,
    pub reserved: u128,
}

/// System metrics and health
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub total_opportunities: u64,
    pub total_trades: u64,
    pub successful_trades: u64,
    pub failed_trades: u64,
    pub total_profit: i128,
    pub average_latency_us: f64,
    pub p99_latency_us: f64,
    pub p99_9_latency_us: f64,
    pub active_workers: usize,
    pub active_routes: usize,
    pub capital_allocated: u128,
    pub capital_available: u128,
}

/// Configuration for the supercolony
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupercolonyConfig {
    pub alchemy_key: String,
    pub private_key: String,
    pub profit_address: String,
    pub initial_capital: u128,
    pub max_workers: usize,
    pub pheromone_ttl_seconds: u64,
    pub min_profit_threshold: u128,
    pub gas_price_multiplier: f64,
}

/// Latency tracker for performance monitoring
#[derive(Debug, Clone)]
pub struct LatencyTracker {
    pub samples: Vec<u64>,  // microseconds
    pub max_samples: usize,
}

impl LatencyTracker {
    pub fn new(max_samples: usize) -> Self {
        Self {
            samples: Vec::with_capacity(max_samples),
            max_samples,
        }
    }

    pub fn record(&mut self, latency_us: u64) {
        self.samples.push(latency_us);
        if self.samples.len() > self.max_samples {
            self.samples.remove(0);
        }
    }

    pub fn average(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        self.samples.iter().sum::<u64>() as f64 / self.samples.len() as f64
    }

    pub fn p99(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let mut sorted = self.samples.clone();
        sorted.sort();
        let idx = (sorted.len() as f64 * 0.99) as usize;
        sorted[idx.min(sorted.len() - 1)] as f64
    }

    pub fn p99_9(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let mut sorted = self.samples.clone();
        sorted.sort();
        let idx = (sorted.len() as f64 * 0.999) as usize;
        sorted[idx.min(sorted.len() - 1)] as f64
    }
}
