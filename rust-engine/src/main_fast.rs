/// Ultra-fast MEV Engine
/// Runs as standalone binary, communicates with Node.js via IPC
/// Target: <10ms end-to-end latency

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};

mod detector;
mod keeper_fast;

use detector::{BellmanFordDetector, Pool};
use keeper_fast::Keeper;

#[derive(Debug, Serialize, Deserialize)]
struct Request {
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct Response {
    id: u64,
    result: serde_json::Value,
    error: Option<String>,
}

struct Engine {
    detector: BellmanFordDetector,
    keeper: Keeper,
}

impl Engine {
    fn new() -> Self {
        Self {
            detector: BellmanFordDetector::new(),
            keeper: Keeper::new(),
        }
    }

    /// Handle incoming request
    fn handle_request(&mut self, req: Request) -> Response {
        let result = match req.method.as_str() {
            "add_pool" => self.add_pool(&req.params),
            "detect" => self.detect(&req.params),
            "execute" => self.execute(&req.params),
            "clear" => self.clear(),
            _ => Err("Unknown method".to_string()),
        };

        Response {
            id: req.id,
            result: result.unwrap_or_else(|e| serde_json::json!({"error": e})),
            error: result.err(),
        }
    }

    /// Add pool to detector
    fn add_pool(&mut self, params: &serde_json::Value) -> Result<serde_json::Value, String> {
        let pool = serde_json::from_value::<Pool>(params.clone())
            .map_err(|e| format!("Invalid pool: {}", e))?;

        self.detector.add_pool(pool);

        Ok(serde_json::json!({"status": "ok"}))
    }

    /// Detect arbitrage opportunities
    fn detect(&self, params: &serde_json::Value) -> Result<serde_json::Value, String> {
        let start_token = params
            .get("start_token")
            .and_then(|v| v.as_str())
            .ok_or("Missing start_token")?;

        let max_hops = params
            .get("max_hops")
            .and_then(|v| v.as_u64())
            .unwrap_or(3) as usize;

        let opportunities = self.detector.detect(start_token, max_hops);

        Ok(serde_json::to_value(opportunities).unwrap())
    }

    /// Execute trade
    fn execute(&self, params: &serde_json::Value) -> Result<serde_json::Value, String> {
        let path: Vec<&str> = params
            .get("path")
            .and_then(|v| v.as_array())
            .ok_or("Missing path")?
            .iter()
            .filter_map(|v| v.as_str())
            .collect();

        let amounts: Vec<f64> = params
            .get("amounts")
            .and_then(|v| v.as_array())
            .ok_or("Missing amounts")?
            .iter()
            .filter_map(|v| v.as_f64())
            .collect();

        let profit_usd = params
            .get("profit_usd")
            .and_then(|v| v.as_f64())
            .ok_or("Missing profit_usd")?;

        let result = self.keeper.execute(&path, &amounts, profit_usd);

        Ok(serde_json::to_value(result).unwrap())
    }

    /// Clear detector
    fn clear(&mut self) -> Result<serde_json::Value, String> {
        self.detector.clear();
        Ok(serde_json::json!({"status": "cleared"}))
    }
}

fn main() {
    let mut engine = Engine::new();
    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin);
    let mut stdout = std::io::stdout();

    eprintln!("[MEV Engine] Started, waiting for requests...");

    for line in reader.lines() {
        match line {
            Ok(line) => {
                if let Ok(req) = serde_json::from_str::<Request>(&line) {
                    let response = engine.handle_request(req);
                    if let Ok(json) = serde_json::to_string(&response) {
                        let _ = writeln!(stdout, "{}", json);
                        let _ = stdout.flush();
                    }
                }
            }
            Err(e) => {
                eprintln!("[MEV Engine] Error reading input: {}", e);
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_creation() {
        let engine = Engine::new();
        // Engine should be created successfully
        assert!(true);
    }
}
