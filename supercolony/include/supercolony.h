#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <atomic>
#include <chrono>
#include <array>

namespace supercolony {

// ============================================================================
// Data Types
// ============================================================================

using Timestamp = std::chrono::high_resolution_clock::time_point;
using Microseconds = std::chrono::microseconds;

inline Timestamp now() {
    return std::chrono::high_resolution_clock::now();
}

inline uint64_t latency_us(Timestamp start, Timestamp end) {
    return std::chrono::duration_cast<Microseconds>(end - start).count();
}

// Pool event from Alchemy WebSocket
struct PoolEvent {
    std::string pool_address;
    std::string token0;
    std::string token1;
    uint64_t reserve0;
    uint64_t reserve1;
    uint64_t fee;
    Timestamp timestamp;
};

// Detected arbitrage opportunity
struct Opportunity {
    std::string id;
    std::vector<std::string> path;  // Token path for swap
    uint64_t amount_in;
    uint64_t expected_profit;
    double profit_percentage;
    Timestamp detected_at;
};

// Transaction to execute
struct Transaction {
    std::string id;
    std::string to;
    std::string data;
    uint64_t gas_limit;
    uint64_t gas_price;
    uint64_t value;
    std::string nonce;
};

// Signed transaction ready for submission
struct SignedTransaction {
    std::string id;
    std::string raw_tx;
    std::string signature;
    Timestamp signed_at;
};

// Transaction result
struct TransactionResult {
    std::string tx_hash;
    bool success;
    uint64_t gas_used;
    int64_t profit_loss;
    std::string error;
    Timestamp executed_at;
};

// Metrics for monitoring
struct Metrics {
    uint64_t total_opportunities;
    uint64_t total_trades;
    uint64_t successful_trades;
    uint64_t failed_trades;
    int64_t total_profit;
    double average_latency_us;
    double p99_latency_us;
    double p99_9_latency_us;
    std::atomic<uint64_t> current_capital;
};

// ============================================================================
// Component Interfaces
// ============================================================================

class PoolMonitor {
public:
    virtual ~PoolMonitor() = default;
    
    virtual void initialize(const std::string& alchemy_key) = 0;
    virtual void start() = 0;
    virtual void stop() = 0;
    virtual std::vector<PoolEvent> getEvents() = 0;
    virtual Metrics getMetrics() const = 0;
};

class DetectionEngine {
public:
    virtual ~DetectionEngine() = default;
    
    virtual void initialize(const std::vector<PoolEvent>& pools) = 0;
    virtual std::vector<Opportunity> detectOpportunities(const PoolEvent& event) = 0;
    virtual Metrics getMetrics() const = 0;
};

class TransactionBuilder {
public:
    virtual ~TransactionBuilder() = default;
    
    virtual void initialize() = 0;
    virtual Transaction build(const Opportunity& opp) = 0;
    virtual Metrics getMetrics() const = 0;
};

class MEVProtection {
public:
    virtual ~MEVProtection() = default;
    
    virtual bool validate(const Transaction& tx) = 0;
    virtual double scoreRisk(const Transaction& tx) = 0;
    virtual Metrics getMetrics() const = 0;
};

class TransactionExecutor {
public:
    virtual ~TransactionExecutor() = default;
    
    virtual void initialize(const std::string& private_key) = 0;
    virtual SignedTransaction sign(const Transaction& tx) = 0;
    virtual TransactionResult submit(const SignedTransaction& tx) = 0;
    virtual Metrics getMetrics() const = 0;
};

class WorkerGroup {
public:
    virtual ~WorkerGroup() = default;
    
    virtual void initialize(const std::string& group_id) = 0;
    virtual void executeOpportunity(const Opportunity& opp) = 0;
    virtual void reportToQueen() = 0;
    virtual Metrics getMetrics() const = 0;
};

class PheromoneBroadcaster {
public:
    virtual ~PheromoneBroadcaster() = default;
    
    virtual void initialize(const std::string& redis_host) = 0;
    virtual void broadcastOpportunity(const Opportunity& opp) = 0;
    virtual void broadcastDanger(const std::string& danger_type) = 0;
    virtual Metrics getMetrics() const = 0;
};

class Queen {
public:
    virtual ~Queen() = default;
    
    virtual void initialize() = 0;
    virtual bool allocateCapital(const std::string& group_id, uint64_t amount) = 0;
    virtual bool validateTrade(const Transaction& tx) = 0;
    virtual void broadcastPheromone(const std::string& signal) = 0;
    virtual Metrics getMetrics() const = 0;
};

// ============================================================================
// Main Supercolony Engine
// ============================================================================

class MEVSupercolony {
public:
    MEVSupercolony();
    ~MEVSupercolony();
    
    void initialize(const std::string& config_file);
    void start();
    void stop();
    
    void executeOpportunity(const Opportunity& opp);
    
    Metrics getMetrics() const;
    
private:
    std::unique_ptr<PoolMonitor> pool_monitor_;
    std::unique_ptr<DetectionEngine> detection_;
    std::unique_ptr<TransactionBuilder> tx_builder_;
    std::unique_ptr<MEVProtection> mev_protection_;
    std::unique_ptr<TransactionExecutor> tx_executor_;
    std::unique_ptr<WorkerGroup> worker_group_;
    std::unique_ptr<PheromoneBroadcaster> pheromone_;
    std::unique_ptr<Queen> queen_;
    
    std::atomic<bool> running_{false};
    Metrics metrics_;
};

} // namespace supercolony
