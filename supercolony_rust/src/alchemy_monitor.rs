use crate::types::*;
use ethers::prelude::*;
use std::sync::Arc;
use tokio::sync::RwLock;
use dashmap::DashMap;

/// Alchemy WebSocket monitor for real-time pool events
/// Listens to Uniswap V3 Swap, Mint, Burn events
pub struct AlchemyMonitor {
    provider: Arc<Provider<Ws>>,
    pools: Arc<DashMap<String, PoolState>>,
    event_count: Arc<RwLock<u64>>,
    last_update: Arc<RwLock<chrono::DateTime<chrono::Utc>>>,
}

impl AlchemyMonitor {
    /// Create new Alchemy monitor
    pub async fn new(alchemy_key: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let ws_url = format!("wss://polygon-mainnet.g.alchemy.com/v2/{}", alchemy_key);
        let provider = Provider::<Ws>::connect(&ws_url).await?;

        Ok(Self {
            provider: Arc::new(provider),
            pools: Arc::new(DashMap::new()),
            event_count: Arc::new(RwLock::new(0)),
            last_update: Arc::new(RwLock::new(chrono::Utc::now())),
        })
    }

    /// Listen to Uniswap V3 Swap events
    pub async fn listen_swap_events(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Uniswap V3 Router address on Polygon
        let router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
            .parse::<Address>()?;

        // Swap event signature
        let swap_event = "Swap(address,address,int256,int256,uint160,uint128,int24)";

        // Create filter for Swap events
        let filter = Filter::new()
            .address(router)
            .event(swap_event);

        // Listen to events
        let mut stream = self.provider.watch(&filter).await?;

        while let Some(log) = stream.next().await {
            // Parse swap event
            let pool_address = format!("0x{:x}", log.address);
            
            // Update pool state
            self.update_pool_from_event(&pool_address, &log).await;

            // Increment event count
            let mut count = self.event_count.write().await;
            *count += 1;

            // Update timestamp
            let mut last_update = self.last_update.write().await;
            *last_update = chrono::Utc::now();
        }

        Ok(())
    }

    /// Listen to Uniswap V3 Mint events (liquidity added)
    pub async fn listen_mint_events(&self) -> Result<(), Box<dyn std::error::Error>> {
        let router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
            .parse::<Address>()?;

        let mint_event = "Mint(address,int24,int24,uint128,uint256,uint256)";

        let filter = Filter::new()
            .address(router)
            .event(mint_event);

        let mut stream = self.provider.watch(&filter).await?;

        while let Some(log) = stream.next().await {
            let pool_address = format!("0x{:x}", log.address);
            self.update_pool_from_event(&pool_address, &log).await;

            let mut count = self.event_count.write().await;
            *count += 1;
        }

        Ok(())
    }

    /// Listen to Uniswap V3 Burn events (liquidity removed)
    pub async fn listen_burn_events(&self) -> Result<(), Box<dyn std::error::Error>> {
        let router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
            .parse::<Address>()?;

        let burn_event = "Burn(address,int24,int24,uint128,uint256,uint256)";

        let filter = Filter::new()
            .address(router)
            .event(burn_event);

        let mut stream = self.provider.watch(&filter).await?;

        while let Some(log) = stream.next().await {
            let pool_address = format!("0x{:x}", log.address);
            self.update_pool_from_event(&pool_address, &log).await;

            let mut count = self.event_count.write().await;
            *count += 1;
        }

        Ok(())
    }

    /// Update pool state from event
    async fn update_pool_from_event(&self, pool_address: &str, _log: &Log) {
        // Simulate pool state update
        // In production, decode the log and extract reserve values
        
        if let Some(mut pool) = self.pools.get_mut(pool_address) {
            pool.updated_at = chrono::Utc::now();
        }
    }

    /// Get all monitored pools
    pub fn get_pools(&self) -> Vec<PoolState> {
        self.pools
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Add pool to monitor
    pub fn add_pool(&self, pool: PoolState) {
        self.pools.insert(pool.address.clone(), pool);
    }

    /// Get event statistics
    pub async fn get_stats(&self) -> (u64, chrono::DateTime<chrono::Utc>) {
        let count = *self.event_count.read().await;
        let last_update = *self.last_update.read().await;
        (count, last_update)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires real Alchemy key
    async fn test_alchemy_monitor_creation() {
        let alchemy_key = std::env::var("ALCHEMY_KEY").unwrap_or_else(|_| "test".to_string());
        
        if alchemy_key != "test" {
            let monitor = AlchemyMonitor::new(&alchemy_key).await;
            assert!(monitor.is_ok());
        }
    }

    #[test]
    fn test_pool_state_clone() {
        let pool = PoolState {
            address: "0x1".to_string(),
            token0: "USDC".to_string(),
            token1: "WETH".to_string(),
            reserve0: 1000000000000,
            reserve1: 500000000000000000000,
            fee: 3000,
            updated_at: chrono::Utc::now(),
        };

        let cloned = pool.clone();
        assert_eq!(pool.address, cloned.address);
    }
}
