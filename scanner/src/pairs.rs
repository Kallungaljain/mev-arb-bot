// ─── DEX Pair Registry ────────────────────────────────────────────────────────
//
// Each entry defines a pair of DEX pools for the same token pair.
// The scanner watches both pools and detects price divergence.

use lazy_static::lazy_static;

#[derive(Debug, Clone)]
pub struct TokenPair {
    pub name: &'static str,
    pub token0: &'static str,   // address (lowercase)
    pub token1: &'static str,   // address (lowercase)
    pub token0_symbol: &'static str,
    pub token1_symbol: &'static str,
    pub token0_decimals: u8,
    pub token1_decimals: u8,
    pub quickswap_pair: &'static str,  // QuickSwap V2 pair address
    pub sushiswap_pair: &'static str,  // SushiSwap pair address
}

lazy_static! {
    pub static ref ALL_PAIRS: Vec<TokenPair> = vec![
        TokenPair {
            name: "WMATIC/USDC",
            token0: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "WMATIC",
            token1_symbol: "USDC",
            token0_decimals: 18,
            token1_decimals: 6,
            quickswap_pair: "0x6e7a5fafcec6bb1e78bae2a1f0b612012bf14827",
            sushiswap_pair: "0xc4e595acdd7d12fec385e5da5d43160e8a0bac0e",
        },
        TokenPair {
            name: "WETH/USDC",
            token0: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "WETH",
            token1_symbol: "USDC",
            token0_decimals: 18,
            token1_decimals: 6,
            quickswap_pair: "0x853ee4b2a13f8a742d64c8f088be7ba2131f670d",
            sushiswap_pair: "0x34965ba0ac2451a34a0471f04cca3f990b8dea27",
        },
        TokenPair {
            name: "WBTC/USDC",
            token0: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // WBTC
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "WBTC",
            token1_symbol: "USDC",
            token0_decimals: 8,
            token1_decimals: 6,
            quickswap_pair: "0xf6a637525402643b0654a54bead2cb9a83c8b498",
            sushiswap_pair: "0xe62ec2e799305e0d367b0cc3ee2cda135bf89816",
        },
        TokenPair {
            name: "WMATIC/WETH",
            token0: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
            token1: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH
            token0_symbol: "WMATIC",
            token1_symbol: "WETH",
            token0_decimals: 18,
            token1_decimals: 18,
            quickswap_pair: "0xadbf1854e5883eb8aa7baf50705338739e558e5b",
            sushiswap_pair: "0xc4e595acdd7d12fec385e5da5d43160e8a0bac0e",
        },
        TokenPair {
            name: "LINK/USDC",
            token0: "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39", // LINK
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "LINK",
            token1_symbol: "USDC",
            token0_decimals: 18,
            token1_decimals: 6,
            quickswap_pair: "0x5ca6ca6c3709e1e6cfe74a50cf6b2b6ba2dadd67",
            sushiswap_pair: "0x74d23f21f780ca26b47db16b0504f2e3832b9321",
        },
        TokenPair {
            name: "AAVE/USDC",
            token0: "0xd6df932a45c0f255f85145f286ea0b292b21c90b", // AAVE
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "AAVE",
            token1_symbol: "USDC",
            token0_decimals: 18,
            token1_decimals: 6,
            quickswap_pair: "0x90bc3e68ba8393a3bf2d79309365089975341a43",
            sushiswap_pair: "0x2813d43463c374a680f814d316ba9a4f2e3e0f7a",
        },
        TokenPair {
            name: "DAI/USDC",
            token0: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // DAI
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "DAI",
            token1_symbol: "USDC",
            token0_decimals: 18,
            token1_decimals: 6,
            quickswap_pair: "0xf04adbf75cdfc5ed26eea4bbbb991db002036bdd",
            sushiswap_pair: "0xcd578f016888b57f1b1e3f887f392f0159e26747",
        },
        TokenPair {
            name: "USDT/USDC",
            token0: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT
            token1: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
            token0_symbol: "USDT",
            token1_symbol: "USDC",
            token0_decimals: 6,
            token1_decimals: 6,
            quickswap_pair: "0x2cf7252e74036d1da831d11089d326296e64a728",
            sushiswap_pair: "0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001",
        },
    ];
}

/// Returns the pair definition for a given pool address (either DEX)
pub fn find_pair_by_pool(pool_addr: &str) -> Option<(&'static TokenPair, bool)> {
    let addr = pool_addr.to_lowercase();
    for pair in ALL_PAIRS.iter() {
        if pair.quickswap_pair == addr {
            return Some((pair, true)); // true = quickswap
        }
        if pair.sushiswap_pair == addr {
            return Some((pair, false)); // false = sushiswap
        }
    }
    None
}

/// Returns all pool addresses to subscribe to (both DEXes for all pairs)
pub fn all_pool_addresses() -> Vec<String> {
    let mut addrs = Vec::new();
    for pair in ALL_PAIRS.iter() {
        addrs.push(pair.quickswap_pair.to_string());
        addrs.push(pair.sushiswap_pair.to_string());
    }
    addrs
}
