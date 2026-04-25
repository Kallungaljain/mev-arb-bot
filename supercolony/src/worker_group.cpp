#include "supercolony.h"
#include <iostream>

namespace supercolony {

class WorkerGroupImpl : public WorkerGroup {
public:
    void initialize(const std::string& group_id) override {
        group_id_ = group_id;
        allocated_capital_ = 0;
        total_profit_ = 0;
        trades_executed_ = 0;
        
        std::cout << "[WorkerGroup] " << group_id << " initialized" << std::endl;
    }
    
    void executeOpportunity(const Opportunity& opp) override {
        auto start = now();
        
        // Simulate execution
        trades_executed_++;
        total_profit_ += opp.expected_profit;
        
        auto end = now();
        auto latency = latency_us(start, end);
        total_latency_us_ += latency;
    }
    
    void reportToQueen() override {
        std::cout << "[WorkerGroup] " << group_id_ 
                  << " - Trades: " << trades_executed_ 
                  << ", Profit: " << total_profit_ << std::endl;
    }
    
    Metrics getMetrics() const override {
        Metrics m;
        m.total_trades = trades_executed_;
        m.total_profit = total_profit_;
        m.current_capital = allocated_capital_;
        if (trades_executed_ > 0) {
            m.average_latency_us = (double)total_latency_us_ / trades_executed_;
        }
        return m;
    }
    
private:
    std::string group_id_;
    std::atomic<uint64_t> allocated_capital_{0};
    std::atomic<int64_t> total_profit_{0};
    std::atomic<uint64_t> trades_executed_{0};
    std::atomic<uint64_t> total_latency_us_{0};
};

std::unique_ptr<WorkerGroup> createWorkerGroup() {
    return std::make_unique<WorkerGroupImpl>();
}

} // namespace supercolony
