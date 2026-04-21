use std::time::{SystemTime, UNIX_EPOCH};

/// Get current timestamp in milliseconds
pub fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Get current timestamp in seconds
pub fn current_timestamp_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Convert Wei to USDC (18 decimals)
pub fn wei_to_usdc(wei: u128) -> f64 {
    wei as f64 / 1_000_000_000_000_000_000.0
}

/// Convert USDC to Wei (18 decimals)
pub fn usdc_to_wei(usdc: f64) -> u128 {
    (usdc * 1_000_000_000_000_000_000.0) as u128
}

/// Calculate slippage percentage
pub fn calculate_slippage(expected: f64, actual: f64) -> f64 {
    if expected == 0.0 {
        return 0.0;
    }
    ((expected - actual) / expected) * 100.0
}

/// Format address for logging
pub fn format_address(address: &str) -> String {
    if address.len() > 10 {
        format!("{}...{}", &address[0..6], &address[address.len()-4..])
    } else {
        address.to_string()
    }
}

/// Validate Ethereum address
pub fn is_valid_address(address: &str) -> bool {
    if !address.starts_with("0x") {
        return false;
    }
    if address.len() != 42 {
        return false;
    }
    address[2..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wei_to_usdc() {
        let wei = 1_000_000_000_000_000_000u128;
        let usdc = wei_to_usdc(wei);
        assert_eq!(usdc, 1.0);
    }

    #[test]
    fn test_usdc_to_wei() {
        let usdc = 1.0;
        let wei = usdc_to_wei(usdc);
        assert_eq!(wei, 1_000_000_000_000_000_000);
    }

    #[test]
    fn test_calculate_slippage() {
        let expected = 100.0;
        let actual = 99.0;
        let slippage = calculate_slippage(expected, actual);
        assert_eq!(slippage, 1.0);
    }

    #[test]
    fn test_format_address() {
        let address = "0x1234567890abcdef1234567890abcdef12345678";
        let formatted = format_address(address);
        assert_eq!(formatted, "0x1234...5678");
    }

    #[test]
    fn test_is_valid_address() {
        assert!(is_valid_address("0x1234567890abcdef1234567890abcdef12345678"));
        assert!(!is_valid_address("0x123")); // Too short
        assert!(!is_valid_address("1234567890abcdef1234567890abcdef12345678")); // No 0x
        assert!(!is_valid_address("0xZZZZ567890abcdef1234567890abcdef12345678")); // Invalid hex
    }
}
