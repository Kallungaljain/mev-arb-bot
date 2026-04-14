// ─── Keeper IPC Client ────────────────────────────────────────────────────────
//
// Sends detected opportunities to the Keeper service via HTTP POST.
// The Keeper then runs its own risk validation and executes the trade.

use anyhow::Result;
use reqwest::Client;
use tracing::debug;
use crate::config::Config;
use crate::engine::Opportunity;

static HTTP_CLIENT: std::sync::OnceLock<Client> = std::sync::OnceLock::new();

fn get_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("Failed to build HTTP client")
    })
}

pub async fn send_opportunity(opp: &Opportunity, cfg: &Config) -> Result<()> {
    let url = format!("{}/internal/opportunity", cfg.keeper_url);

    debug!("Sending opportunity to Keeper: {}", opp.pair_name);

    let response = get_client()
        .post(&url)
        .header("X-Keeper-Secret", &cfg.keeper_secret)
        .header("Content-Type", "application/json")
        .json(opp)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Keeper returned {}: {}", status, body);
    }

    debug!("Keeper accepted opportunity: {}", opp.pair_name);
    Ok(())
}
