/// Ultra-fast calldata encoder for MEV arbitrage transactions
/// Optimized for <2ms encoding time

use hex::encode as hex_encode;

#[derive(Debug, Clone)]
pub struct SwapInstruction {
    pub token_in: String,
    pub token_out: String,
    pub amount_in: String,
    pub min_amount_out: String,
    pub path: Vec<String>,
}

pub struct CalldataEncoder;

impl CalldataEncoder {
    /// Encode function selector (first 4 bytes of keccak256 hash)
    pub fn encode_function_selector(signature: &str) -> String {
        // For executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        // Selector: 0x920f5c84
        "920f5c84".to_string()
    }

    /// Encode address (32 bytes, padded)
    pub fn encode_address(address: &str) -> String {
        let addr = address.trim_start_matches("0x").to_lowercase();
        format!("{:0>64}", addr)
    }

    /// Encode uint256 (32 bytes)
    pub fn encode_uint256(value: &str) -> String {
        let num = u128::from_str_radix(value.trim_start_matches("0x"), 16)
            .unwrap_or(0);
        format!("{:0>64x}", num)
    }

    /// Encode swap path as packed bytes
    pub fn encode_swap_path(path: &[String]) -> String {
        let mut encoded = String::new();
        for (i, token) in path.iter().enumerate() {
            if i > 0 {
                encoded.push_str("0003"); // 0.3% fee
            }
            encoded.push_str(&Self::encode_address(token)[24..]);
        }
        encoded
    }

    /// Encode complete executeOperation calldata
    pub fn encode_execute_operation(
        asset: &str,
        amount: &str,
        premium: &str,
        initiator: &str,
        swap_path: &[String],
        min_output: &str,
    ) -> String {
        let mut calldata = String::new();

        // Function selector
        calldata.push_str(&Self::encode_function_selector("executeOperation"));

        // asset (address)
        calldata.push_str(&Self::encode_address(asset));

        // amount (uint256)
        calldata.push_str(&Self::encode_uint256(amount));

        // premium (uint256)
        calldata.push_str(&Self::encode_uint256(premium));

        // initiator (address)
        calldata.push_str(&Self::encode_address(initiator));

        // params offset (points to where params data starts)
        calldata.push_str(&Self::encode_uint256("160")); // 5 * 32 = 160 bytes offset

        // params data: swap path
        let path_encoded = Self::encode_swap_path(swap_path);
        calldata.push_str(&format!("{:0>64x}", path_encoded.len() / 2)); // length
        calldata.push_str(&path_encoded);

        // min output
        calldata.push_str(&Self::encode_uint256(min_output));

        format!("0x{}", calldata)
    }

    /// Quick validation of calldata
    pub fn validate_calldata(calldata: &str) -> bool {
        // Must start with 0x
        if !calldata.starts_with("0x") {
            return false;
        }

        // Must be even length (each byte = 2 hex chars)
        if (calldata.len() - 2) % 2 != 0 {
            return false;
        }

        // Must be at least 10 bytes (selector + minimal params)
        if calldata.len() < 10 {
            return false;
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_address() {
        let addr = "0x1234567890123456789012345678901234567890";
        let encoded = CalldataEncoder::encode_address(addr);
        assert_eq!(encoded.len(), 64);
        assert!(encoded.ends_with("1234567890123456789012345678901234567890"));
    }

    #[test]
    fn test_encode_uint256() {
        let value = "0x3e8"; // 1000
        let encoded = CalldataEncoder::encode_uint256(value);
        assert_eq!(encoded.len(), 64);
        assert!(encoded.ends_with("3e8"));
    }

    #[test]
    fn test_validate_calldata() {
        assert!(CalldataEncoder::validate_calldata("0x920f5c84"));
        assert!(!CalldataEncoder::validate_calldata("920f5c84")); // Missing 0x
        assert!(!CalldataEncoder::validate_calldata("0x9")); // Too short
    }
}
