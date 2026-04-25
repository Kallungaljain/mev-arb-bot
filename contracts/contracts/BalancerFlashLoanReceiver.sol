// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BalancerFlashLoanReceiver
 * @dev Flash loan receiver for Balancer V2 MEV arbitrage
 * 
 * Flow:
 * 1. Backend calls vault.flashLoan(receiver, tokens, amounts, userData)
 * 2. Vault transfers tokens to this contract
 * 3. receiveFlashLoan() executes arbitrage trades
 * 4. Repays tokens to vault (NO FEE)
 * 5. Transfers profit to owner
 */
contract BalancerFlashLoanReceiver is IFlashLoanRecipient, Ownable {

    IVault public immutable vault;
    address public profitRecipient;

    // Events
    event FlashLoanExecuted(
        address[] tokens,
        uint256[] amounts,
        uint256[] profits
    );
    event ProfitTransferred(address indexed token, uint256 amount);
    event ProfitRecipientUpdated(address indexed newRecipient);

    constructor(address _vault, address _profitRecipient) Ownable(msg.sender) {
        require(_vault != address(0), "Invalid vault address");
        require(_profitRecipient != address(0), "Invalid profit recipient");
        
        vault = IVault(_vault);
        profitRecipient = _profitRecipient;
    }

    /**
     * @dev Receive flash loan from Balancer vault
     * @param tokens Array of token addresses
     * @param amounts Array of amounts borrowed
     * @param feeAmounts Array of fees (always 0 for Balancer)
     * @param userData Encoded arbitrage data
     */
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == address(vault), "Unauthorized caller");
        require(tokens.length == amounts.length, "Length mismatch");

        // Decode arbitrage data
        (
            address[] memory path,
            uint256[] memory swapAmounts,
            uint256 deadline,
            address swapRouter
        ) = abi.decode(userData, (address[], uint256[], uint256, address));

        // Execute arbitrage trades
        _executeArbitrage(tokens, amounts, path, swapAmounts, deadline, swapRouter);

        // Calculate profits
        uint256[] memory profits = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balance = tokens[i].balanceOf(address(this));
            require(balance >= amounts[i], "Insufficient balance for repayment");
            
            profits[i] = balance - amounts[i];

            // Approve vault for repayment (NO FEE for Balancer)
            tokens[i].approve(address(vault), amounts[i]);
        }

        // Transfer profits to recipient
        _transferProfits(tokens, profits);

        // Emit event
        address[] memory tokenAddresses = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenAddresses[i] = address(tokens[i]);
        }
        emit FlashLoanExecuted(tokenAddresses, amounts, profits);
    }

    /**
     * @dev Execute arbitrage trades
     * @param tokens Array of token addresses
     * @param amounts Array of amounts borrowed
     * @param path Swap path (token addresses in order)
     * @param swapAmounts Expected amounts at each step
     * @param deadline Swap deadline
     * @param swapRouter Router contract address (1inch, Uniswap, etc)
     */
    function _executeArbitrage(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address[] memory path,
        uint256[] memory swapAmounts,
        uint256 deadline,
        address swapRouter
    ) internal {
        require(path.length >= 2, "Invalid path");
        require(swapRouter != address(0), "Invalid router");

        // Approve first token to router
        IERC20(path[0]).approve(swapRouter, amounts[0]);

        // Execute swaps via router
        // This is a generic interface - actual implementation depends on router
        (bool success, ) = swapRouter.call(
            abi.encodeWithSignature(
                "swap(address[],uint256[],uint256,uint256)",
                path,
                swapAmounts,
                deadline,
                block.timestamp
            )
        );

        require(success, "Swap failed");
    }

    /**
     * @dev Transfer profits to recipient
     * @param tokens Array of token addresses
     * @param profits Array of profit amounts
     */
    function _transferProfits(IERC20[] memory tokens, uint256[] memory profits) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (profits[i] > 0) {
                tokens[i].transfer(profitRecipient, profits[i]);
                emit ProfitTransferred(address(tokens[i]), profits[i]);
            }
        }
    }

    /**
     * @dev Update profit recipient
     * @param _newRecipient New profit recipient address
     */
    function setProfitRecipient(address _newRecipient) external onlyOwner {
        require(_newRecipient != address(0), "Invalid address");
        profitRecipient = _newRecipient;
        emit ProfitRecipientUpdated(_newRecipient);
    }

    /**
     * @dev Emergency withdrawal of tokens
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    /**
     * @dev Get contract balance for a token
     * @param token Token address
     * @return Balance of the token
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Receive ETH
     */
    receive() external payable {}
}
