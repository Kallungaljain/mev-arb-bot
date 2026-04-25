#include "supercolony.h"
#include <iostream>
#include <sstream>
#include <iomanip>

namespace supercolony {

class TransactionBuilderImpl : public TransactionBuilder {
public:
    void initialize() override {
        // Pre-compute gas estimates
        gas_cache_["swap_2"] = 150000;
        gas_cache_["swap_3"] = 200000;
        gas_cache_["flash_loan"] = 250000;
        
        std::cout << "[TransactionBuilder] Initialized with gas cache" << std::endl;
    }
    
    Transaction build(const Opportunity& opp) override {
        auto start = now();
        
        Transaction tx;
        tx.id = opp.id;
        tx.to = "0x1111111254fb6c44bac0bed2854e76f90643097d";  // 1inch router
        
        // Build calldata from opportunity
        tx.data = buildCalldata(opp);
        
        // Get cached gas estimate
        std::string swap_type = "swap_" + std::to_string(opp.path.size());
        tx.gas_limit = gas_cache_[swap_type];
        
        // Dynamic gas price (simplified)
        tx.gas_price = 50000000000;  // 50 gwei
        tx.value = 0;
        tx.nonce = "0";
        
        auto end = now();
        auto latency = latency_us(start, end);
        total_latency_us_ += latency;
        transactions_built_++;
        
        return tx;
    }
    
    Metrics getMetrics() const override {
        Metrics m;
        m.total_trades = transactions_built_;
        if (transactions_built_ > 0) {
            m.average_latency_us = (double)total_latency_us_ / transactions_built_;
        }
        return m;
    }
    
private:
    std::unordered_map<std::string, uint64_t> gas_cache_;
    std::atomic<uint64_t> transactions_built_{0};
    std::atomic<uint64_t> total_latency_us_{0};
    
    std::string buildCalldata(const Opportunity& opp) {
        // Simplified calldata building
        // In production, would use proper ABI encoding
        
        std::stringstream ss;
        ss << "0x";
        
        // Function selector for swap (4 bytes)
        ss << "12aa3caf";
        
        // Encode path
        for (const auto& token : opp.path) {
            ss << std::setfill('0') << std::setw(40) << token;
        }
        
        // Encode amounts
        ss << std::hex << opp.amount_in;
        ss << std::hex << opp.expected_profit;
        
        return ss.str();
    }
};

std::unique_ptr<TransactionBuilder> createTransactionBuilder() {
    return std::make_unique<TransactionBuilderImpl>();
}

} // namespace supercolony
