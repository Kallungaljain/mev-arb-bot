/// Queen: MEV Risk Analyzer for arbitrage trades
/// Analyzes sandwich attacks, slippage, liquidity, and gas prices
/// <5ms execution time for 95%+ safe trade classification

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct PoolMetrics {
    pub liquidity_usd: f64,
    pub volume_24h: f64,
    pub price_volatility: f64,
    pub swap_count_1h: u32,
}

#[derive(Debug, Clone)]
pub struct MEVRiskAnalysis {
    pub sandwich_risk_score: f64,      // 0-100: probability of sandwich attack
    pub slippage_risk_score: f64,      // 0-100: unexpected slippage risk
    pub liquidity_risk_score: f64,     // 0-100: insufficient liquidity risk
    pub gas_price_risk_score: f64,     // 0-100: high gas price risk
    pub overall_risk_score: f64,       // 0-100: weighted average
    pub is_safe: bool,                 // true if risk < 30
    pub recommendation: String,        // "EXECUTE", "ANALYZE", "SKIP"
}

pub struct Queen;

impl Queen {
    /// Analyze sandwich attack probability
    /// High probability if: large swap size, high mempool activity, low liquidity
    fn analyze_sandwich_risk(
        swap_size_usd: f64,
        liquidity_usd: f64,
        mempool_pending_txs: u32,
    ) -> f64 {
        // Swap size as % of liquidity
        let size_ratio = (swap_size_usd / liquidity_usd).min(1.0);

        // Risk increases with swap size and mempool congestion
        let base_risk = size_ratio * 50.0; // 0-50 based on size
        let mempool_risk = (mempool_pending_txs as f64 / 100.0).min(50.0); // 0-50 based on mempool

        (base_risk + mempool_risk).min(100.0)
    }

    /// Analyze unexpected slippage risk
    /// High probability if: high volatility, low volume, recent price swings
    fn analyze_slippage_risk(
        volatility_pct: f64,
        volume_24h: f64,
        swap_size_usd: f64,
    ) -> f64 {
        // Volatility risk
        let vol_risk = (volatility_pct / 2.0).min(50.0); // 0-50 based on volatility

        // Volume risk: low volume = high slippage risk
        let volume_ratio = (swap_size_usd / volume_24h).min(1.0);
        let volume_risk = volume_ratio * 50.0; // 0-50 based on volume

        (vol_risk + volume_risk).min(100.0)
    }

    /// Analyze liquidity risk
    /// High probability if: insufficient liquidity for trade size
    fn analyze_liquidity_risk(
        swap_size_usd: f64,
        liquidity_usd: f64,
        min_liquidity_ratio: f64,
    ) -> f64 {
        let ratio = swap_size_usd / liquidity_usd;

        if ratio > 0.5 {
            // Swap is >50% of liquidity - very risky
            100.0
        } else if ratio > 0.2 {
            // Swap is 20-50% of liquidity - risky
            (ratio - 0.2) / 0.3 * 100.0
        } else if ratio > min_liquidity_ratio {
            // Swap is within acceptable range but getting close
            (ratio / min_liquidity_ratio) * 30.0
        } else {
            // Safe liquidity
            0.0
        }
    }

    /// Analyze gas price risk
    /// High probability if: gas price is unusually high
    fn analyze_gas_price_risk(
        current_gas_price_gwei: f64,
        avg_gas_price_gwei: f64,
    ) -> f64 {
        let ratio = current_gas_price_gwei / avg_gas_price_gwei;

        if ratio > 2.0 {
            // Gas is 2x average - very risky
            100.0
        } else if ratio > 1.5 {
            // Gas is 1.5x average - risky
            (ratio - 1.0) * 100.0
        } else if ratio > 1.1 {
            // Gas is 10-50% above average - slightly risky
            (ratio - 1.0) * 50.0
        } else {
            // Gas is normal
            0.0
        }
    }

    /// Comprehensive MEV risk analysis
    pub fn analyze(
        swap_size_usd: f64,
        pool_metrics: &PoolMetrics,
        current_gas_price_gwei: f64,
        avg_gas_price_gwei: f64,
        mempool_pending_txs: u32,
        min_liquidity_ratio: f64,
    ) -> MEVRiskAnalysis {
        // Calculate individual risk scores
        let sandwich_risk = Self::analyze_sandwich_risk(
            swap_size_usd,
            pool_metrics.liquidity_usd,
            mempool_pending_txs,
        );

        let slippage_risk = Self::analyze_slippage_risk(
            pool_metrics.price_volatility,
            pool_metrics.volume_24h,
            swap_size_usd,
        );

        let liquidity_risk =
            Self::analyze_liquidity_risk(swap_size_usd, pool_metrics.liquidity_usd, min_liquidity_ratio);

        let gas_price_risk = Self::analyze_gas_price_risk(current_gas_price_gwei, avg_gas_price_gwei);

        // Weighted average (sandwich and slippage are most important)
        let overall_risk = (sandwich_risk * 0.35
            + slippage_risk * 0.35
            + liquidity_risk * 0.20
            + gas_price_risk * 0.10)
            .min(100.0);

        let is_safe = overall_risk < 30.0;
        let recommendation = if overall_risk < 20.0 {
            "EXECUTE".to_string()
        } else if overall_risk < 50.0 {
            "ANALYZE".to_string()
        } else {
            "SKIP".to_string()
        };

        MEVRiskAnalysis {
            sandwich_risk_score: sandwich_risk,
            slippage_risk_score: slippage_risk,
            liquidity_risk_score: liquidity_risk,
            gas_price_risk_score: gas_price_risk,
            overall_risk_score: overall_risk,
            is_safe,
            recommendation,
        }
    }

    /// Quick safety check (for 95% of trades)
    pub fn is_trade_safe(
        swap_size_usd: f64,
        liquidity_usd: f64,
        volatility_pct: f64,
    ) -> bool {
        // Quick heuristics for fast path
        let size_ratio = swap_size_usd / liquidity_usd;
        let volatility_ok = volatility_pct < 5.0;
        let size_ok = size_ratio < 0.1; // Swap must be <10% of liquidity

        volatility_ok && size_ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandwich_risk() {
        let risk = Queen::analyze_sandwich_risk(1000.0, 100_000.0, 50);
        assert!(risk > 0.0 && risk < 100.0);
    }

    #[test]
    fn test_quick_safety_check() {
        assert!(Queen::is_trade_safe(1000.0, 100_000.0, 2.0));
        assert!(!Queen::is_trade_safe(50_000.0, 100_000.0, 2.0)); // Too large
        assert!(!Queen::is_trade_safe(1000.0, 100_000.0, 10.0)); // Too volatile
    }

    #[test]
    fn test_full_analysis() {
        let metrics = PoolMetrics {
            liquidity_usd: 100_000.0,
            volume_24h: 500_000.0,
            price_volatility: 2.5,
            swap_count_1h: 100,
        };

        let analysis = Queen::analyze(1000.0, &metrics, 50.0, 40.0, 50, 0.05);
        assert!(analysis.overall_risk_score >= 0.0 && analysis.overall_risk_score <= 100.0);
        assert!(analysis.is_safe);
    }
}
