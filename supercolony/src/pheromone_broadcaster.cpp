#include "supercolony.h"
#include <iostream>

namespace supercolony {

class PheromoneBroadcasterImpl : public PheromoneBroadcaster {
public:
    void initialize(const std::string& redis_host) override {
        redis_host_ = redis_host;
        std::cout << "[PheromoneBroadcaster] Initialized with Redis: " << redis_host << std::endl;
    }
    
    void broadcastOpportunity(const Opportunity& opp) override {
        auto start = now();
        
        // Broadcast opportunity to other workers
        std::cout << "[Pheromone] Opportunity: " << opp.id 
                  << " Profit: " << opp.expected_profit << std::endl;
        
        opportunities_broadcast_++;
        
        auto end = now();
        auto latency = latency_us(start, end);
        total_latency_us_ += latency;
    }
    
    void broadcastDanger(const std::string& danger_type) override {
        auto start = now();
        
        // Broadcast danger signal
        std::cout << "[Pheromone] Danger: " << danger_type << std::endl;
        
        danger_signals_++;
        
        auto end = now();
        auto latency = latency_us(start, end);
        total_latency_us_ += latency;
    }
    
    Metrics getMetrics() const override {
        Metrics m;
        m.total_opportunities = opportunities_broadcast_;
        if ((opportunities_broadcast_ + danger_signals_) > 0) {
            m.average_latency_us = (double)total_latency_us_ / (opportunities_broadcast_ + danger_signals_);
        }
        return m;
    }
    
private:
    std::string redis_host_;
    std::atomic<uint64_t> opportunities_broadcast_{0};
    std::atomic<uint64_t> danger_signals_{0};
    std::atomic<uint64_t> total_latency_us_{0};
};

std::unique_ptr<PheromoneBroadcaster> createPheromoneBroadcaster() {
    return std::make_unique<PheromoneBroadcasterImpl>();
}

} // namespace supercolony
