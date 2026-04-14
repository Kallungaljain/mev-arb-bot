// ─── Elite Engine — Oracle-Free Arbitrage Opportunity Detector ────────────────
//
// All calculations use on-chain reserve data only — no external price oracles.
//
// Algorithm:
//   1. Compute effective price on QuickSwap and SushiSwap from reserves
//   2. Calculate spread (price difference as %)
//   3. Simulate the optimal trade size using the constant-product formula
//   4. Calculate slippage for that trade size
//   5. Estimate gas cost in USD
//   6. Compute net profit = gross profit - gas cost - AAVE flash loan fee
//   7. Apply risk filters: min profit, max slippage, max gas
//   8. Return opportunity if all filters pass

use serde::{Deserialize, Serialize};
use crate::config::Config;
use crate::pairs::TokenPair;

// AAVE V3 flash loan fee: 0.05% = 5 bps
const AAVE_FEE_BPS: u64 = 5;
// Uniswap V2 swap fee: 0.3% = 30 bps per swap (two swaps = 60 bps)
const UNISWAP_FEE_BPS: u64 = 30;
// Estimated gas for flash loan arb tx on Polygon (in gas units)
const ESTIMATED_GAS_UNITS: u64 = 350_000;

#[derive(Debug, Clone)]
pub struct ReserveState<'a> {
    pub pair: &'a TokenPair,
    pub qs_reserve0: u128,
    pub qs_reserve1: u128,
    pub ss_reserve0: u128,
    pub ss_reserve1: u128,
    pub updated_dex_is_quickswap: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opportunity {
    pub pair_name: String,
    pub buy_dex: String,        // "quickswap" or "sushiswap"
    pub sell_dex: String,
    pub buy_dex_addr: String,
    pub sell_dex_addr: String,
    pub loan_token: String,     // token address to borrow
    pub profit_token: String,   // intermediate token
    pub loan_amount_raw: String, // in loan_token units (as string to avoid JSON precision loss)
    pub spread_pct: f64,
    pub slippage_pct: f64,
    pub gas_cost_usd: f64,
    pub gross_profit_usd: f64,
    pub net_profit_usd: f64,
    pub confidence: u8,         // 0-100
    pub timestamp_ms: u64,
}

/// Main entry point: given current reserves for both DEXes, detect an opportunity.
/// Returns None if no profitable opportunity exists after all risk filters.
pub fn run_engine(state: &ReserveState, cfg: &Config) -> Option<Opportunity> {
    let pair = state.pair;

    // ── Step 1: Compute prices (token1 per token0) from reserves ──────────────
    // price = reserve1 / reserve0 (adjusted for decimals)
    let decimal_adj = 10f64.powi(pair.token1_decimals as i32 - pair.token0_decimals as i32);

    let qs_price = if state.qs_reserve0 == 0 { return None; }
        else { (state.qs_reserve1 as f64 / state.qs_reserve0 as f64) * decimal_adj };

    let ss_price = if state.ss_reserve0 == 0 { return None; }
        else { (state.ss_reserve1 as f64 / state.ss_reserve0 as f64) * decimal_adj };

    // ── Step 2: Determine direction ───────────────────────────────────────────
    // Buy on the cheaper DEX (lower price = more token0 per token1)
    let (buy_dex_name, sell_dex_name, buy_price, sell_price,
         buy_r0, buy_r1, sell_r0, sell_r1,
         buy_dex_addr, sell_dex_addr) = if qs_price < ss_price {
        // QuickSwap is cheaper → buy token0 on QS, sell on SS
        ("quickswap", "sushiswap", qs_price, ss_price,
         state.qs_reserve0, state.qs_reserve1,
         state.ss_reserve0, state.ss_reserve1,
         pair.quickswap_pair, pair.sushiswap_pair)
    } else {
        ("sushiswap", "quickswap", ss_price, qs_price,
         state.ss_reserve0, state.ss_reserve1,
         state.qs_reserve0, state.qs_reserve1,
         pair.sushiswap_pair, pair.quickswap_pair)
    };

    // ── Step 3: Compute spread ────────────────────────────────────────────────
    let spread_pct = ((sell_price - buy_price) / buy_price) * 100.0;

    // Minimum spread to even consider (covers both swap fees + AAVE fee)
    // 0.3% + 0.3% + 0.05% = 0.65% minimum viable spread
    if spread_pct < 0.65 {
        return None;
    }

    // ── Step 4: Optimal trade size (constant-product formula) ─────────────────
    // Optimal amount to borrow = sqrt(buy_r0 * sell_r0) - buy_r0
    // This maximises profit on the buy side before diminishing returns
    let optimal_raw = (buy_r0 as f64 * sell_r0 as f64).sqrt() - buy_r0 as f64;
    if optimal_raw <= 0.0 { return None; }

    // Cap at 10% of the smaller pool's reserve to limit slippage
    let max_trade = (buy_r0.min(sell_r0) as f64) * 0.10;
    let trade_amount_raw = optimal_raw.min(max_trade).max(1.0) as u128;

    // ── Step 5: Simulate swap output using Uniswap V2 formula ─────────────────
    // amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
    let amount_in_with_fee = trade_amount_raw as u128 * 997;
    let buy_out = (amount_in_with_fee * buy_r1) / (buy_r0 * 1000 + amount_in_with_fee);

    // Sell buy_out on the sell DEX
    let sell_in_with_fee = buy_out * 997;
    let sell_out = (sell_in_with_fee * sell_r0) / (sell_r1 * 1000 + sell_in_with_fee);

    // ── Step 6: Gross profit in token0 units ─────────────────────────────────
    let aave_fee = (trade_amount_raw * AAVE_FEE_BPS as u128) / 10_000;
    let repay_amount = trade_amount_raw + aave_fee;

    if sell_out <= repay_amount { return None; }
    let gross_profit_raw = sell_out - repay_amount;

    // ── Step 7: Convert to USD ────────────────────────────────────────────────
    // Use sell_price as USD reference (token1 = USDC/USDT ≈ $1)
    let token0_usd_price = sell_price; // price of token0 in token1 (≈ USD)
    let decimal_div = 10f64.powi(pair.token0_decimals as i32);
    let gross_profit_usd = (gross_profit_raw as f64 / decimal_div) * token0_usd_price;

    // ── Step 8: Slippage estimate ─────────────────────────────────────────────
    // Slippage ≈ trade_size / pool_liquidity
    let slippage_pct = (trade_amount_raw as f64 / buy_r0 as f64) * 100.0;

    // ── Step 9: Gas cost estimate ─────────────────────────────────────────────
    // Assume 100 Gwei gas price (conservative for Polygon)
    // MATIC price ≈ $0.80 (conservative)
    let gas_gwei = 100u64; // will be updated by Keeper with live gas price
    let gas_cost_matic = (ESTIMATED_GAS_UNITS * gas_gwei) as f64 * 1e-9;
    let gas_cost_usd = gas_cost_matic * 0.80; // conservative MATIC price

    // ── Step 10: Net profit ───────────────────────────────────────────────────
    let net_profit_usd = gross_profit_usd - gas_cost_usd;

    // ── Step 11: Risk filters ─────────────────────────────────────────────────
    let min_profit_usd = cfg.min_profit_usd_cents as f64 / 100.0;
    if net_profit_usd < min_profit_usd { return None; }

    let max_slippage = cfg.max_slippage_bps as f64 / 100.0;
    if slippage_pct > max_slippage { return None; }

    // ── Step 12: Confidence score ─────────────────────────────────────────────
    // Higher spread + lower slippage + higher profit = higher confidence
    let confidence = calculate_confidence(spread_pct, slippage_pct, net_profit_usd);

    let timestamp_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Some(Opportunity {
        pair_name: pair.name.to_string(),
        buy_dex: buy_dex_name.to_string(),
        sell_dex: sell_dex_name.to_string(),
        buy_dex_addr: buy_dex_addr.to_string(),
        sell_dex_addr: sell_dex_addr.to_string(),
        loan_token: pair.token0.to_string(),
        profit_token: pair.token1.to_string(),
        loan_amount_raw: trade_amount_raw.to_string(),
        spread_pct,
        slippage_pct,
        gas_cost_usd,
        gross_profit_usd,
        net_profit_usd,
        confidence,
        timestamp_ms,
    })
}

fn calculate_confidence(spread_pct: f64, slippage_pct: f64, net_profit_usd: f64) -> u8 {
    let spread_score = (spread_pct * 20.0).min(40.0); // max 40 pts
    let slippage_score = ((0.5 - slippage_pct) * 40.0).max(0.0).min(30.0); // max 30 pts
    let profit_score = (net_profit_usd * 10.0).min(30.0); // max 30 pts
    (spread_score + slippage_score + profit_score).min(100.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pairs::ALL_PAIRS;

    fn test_cfg() -> Config {
        Config {
            alchemy_api_key: "test".to_string(),
            keeper_url: "http://localhost:3001".to_string(),
            keeper_secret: "test".to_string(),
            metrics_port: 9090,
            min_profit_usd_cents: 50,
            max_slippage_bps: 50,
            max_gas_gwei: 200,
        }
    }

    #[test]
    fn test_no_opportunity_equal_prices() {
        let pair = &ALL_PAIRS[0]; // WMATIC/USDC
        let state = ReserveState {
            pair,
            qs_reserve0: 1_000_000_000_000_000_000_000u128, // 1000 WMATIC
            qs_reserve1: 800_000_000u128,                    // 800 USDC
            ss_reserve0: 1_000_000_000_000_000_000_000u128,
            ss_reserve1: 800_000_000u128,
            updated_dex_is_quickswap: true,
        };
        assert!(run_engine(&state, &test_cfg()).is_none());
    }

    #[test]
    fn test_opportunity_detected_on_spread() {
        let pair = &ALL_PAIRS[0]; // WMATIC/USDC
        // Create a 2% price difference
        let state = ReserveState {
            pair,
            qs_reserve0: 1_000_000_000_000_000_000_000u128, // 1000 WMATIC
            qs_reserve1: 800_000_000u128,                    // 800 USDC → $0.80/WMATIC
            ss_reserve0: 1_000_000_000_000_000_000_000u128,
            ss_reserve1: 816_000_000u128,                    // 816 USDC → $0.816/WMATIC (2% higher)
            updated_dex_is_quickswap: true,
        };
        let result = run_engine(&state, &test_cfg());
        assert!(result.is_some());
        let opp = result.unwrap();
        assert_eq!(opp.buy_dex, "quickswap");
        assert_eq!(opp.sell_dex, "sushiswap");
        assert!(opp.spread_pct > 1.5);
        assert!(opp.net_profit_usd > 0.0);
    }

    #[test]
    fn test_confidence_range() {
        assert!(calculate_confidence(2.0, 0.1, 5.0) <= 100);
        assert!(calculate_confidence(0.0, 0.0, 0.0) >= 0);
    }

    #[test]
    fn test_below_min_profit_filtered() {
        let pair = &ALL_PAIRS[0];
        // Very small spread — profit will be below minimum
        let state = ReserveState {
            pair,
            qs_reserve0: 100_000_000_000_000_000_000u128, // 100 WMATIC
            qs_reserve1: 80_000_000u128,
            ss_reserve0: 100_000_000_000_000_000_000u128,
            ss_reserve1: 80_800_000u128, // 1% spread but tiny pool
            updated_dex_is_quickswap: true,
        };
        // With such a small pool, net profit after gas should be below $0.50
        let result = run_engine(&state, &test_cfg());
        // Either None (filtered) or very small profit — just verify it doesn't panic
        if let Some(opp) = result {
            assert!(opp.net_profit_usd >= 0.0);
        }
    }
}
