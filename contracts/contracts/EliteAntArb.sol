// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── Interfaces ───────────────────────────────────────────────────────────────

/// @dev Minimal AAVE V3 Pool interface — only what we need
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @dev AAVE V3 flash loan callback
interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

/// @dev Uniswap V2 / QuickSwap / SushiSwap pair interface
interface IUniswapV2Pair {
    function getReserves() external view returns (
        uint112 reserve0,
        uint112 reserve1,
        uint32 blockTimestampLast
    );
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @dev Minimal ERC-20 interface
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// ─── EliteAntArb ──────────────────────────────────────────────────────────────

/**
 * @title  EliteAntArb
 * @notice Oracle-free flash loan arbitrage contract for Polygon.
 *
 * Flow:
 *   1. Keeper calls executeArb() with the opportunity parameters.
 *   2. Contract requests a flash loan from AAVE V3 for `loanToken` amount.
 *   3. In executeOperation():
 *      a. Swap loanToken → profitToken on DEX A (buyDex).
 *      b. Swap profitToken → loanToken on DEX B (sellDex).
 *      c. Verify net profit >= minProfit (oracle-free: uses actual received amounts).
 *      d. Repay flash loan (principal + AAVE premium).
 *      e. Transfer profit to profitWallet.
 *   4. If any step fails or profit < minProfit, the entire tx reverts — no loss.
 *
 * Oracle-free design:
 *   All price checks use the actual token amounts received from swaps,
 *   not external price feeds. The contract only succeeds if the real
 *   on-chain arithmetic produces a profit after fees.
 */
contract EliteAntArb is IFlashLoanSimpleReceiver {

    // ── State ──────────────────────────────────────────────────────────────────

    address public immutable owner;
    address public immutable aavePool;
    address public profitWallet;
    uint256 public minProfitWei;   // minimum net profit in loanToken units
    bool    public paused;

    // ── Events ─────────────────────────────────────────────────────────────────

    event ArbExecuted(
        address indexed loanToken,
        uint256 loanAmount,
        uint256 profit,
        address buyDex,
        address sellDex
    );
    event ProfitWithdrawn(address token, uint256 amount, address to);
    event Paused(bool state);

    // ── Errors ─────────────────────────────────────────────────────────────────

    error NotOwner();
    error ContractPaused();
    error NotAavePool();
    error ProfitBelowMinimum(uint256 actual, uint256 minimum);
    error InsufficientRepayment();
    error ZeroAddress();

    // ── Modifiers ──────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier notPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param _aavePool     AAVE V3 Pool address on Polygon
     *                      (0x794a61358D6845594F94dc1DB02A252b5b4814aD)
     * @param _profitWallet Address that receives arbitrage profits
     * @param _minProfitWei Minimum net profit in loanToken units to proceed
     */
    constructor(
        address _aavePool,
        address _profitWallet,
        uint256 _minProfitWei
    ) {
        if (_aavePool == address(0) || _profitWallet == address(0)) revert ZeroAddress();
        owner        = msg.sender;
        aavePool     = _aavePool;
        profitWallet = _profitWallet;
        minProfitWei = _minProfitWei;
    }

    // ── External: Keeper Entry Point ───────────────────────────────────────────

    /**
     * @notice Called by the Keeper to execute a flash loan arbitrage.
     * @param loanToken   Token to borrow (e.g. USDC)
     * @param loanAmount  Amount to borrow in loanToken units
     * @param buyDex      Uniswap V2-compatible pair address — buy profitToken here
     * @param sellDex     Uniswap V2-compatible pair address — sell profitToken here
     * @param profitToken Intermediate token (e.g. WMATIC)
     * @param minProfit   Minimum acceptable net profit (keeper-side safety check)
     */
    function executeArb(
        address loanToken,
        uint256 loanAmount,
        address buyDex,
        address sellDex,
        address profitToken,
        uint256 minProfit
    ) external notPaused {
        // Only owner or approved keeper can trigger
        if (msg.sender != owner) revert NotOwner();

        bytes memory params = abi.encode(
            buyDex,
            sellDex,
            profitToken,
            minProfit
        );

        IPool(aavePool).flashLoanSimple(
            address(this),
            loanToken,
            loanAmount,
            params,
            0 // referralCode
        );
    }

    // ── AAVE Callback ──────────────────────────────────────────────────────────

    /**
     * @notice AAVE V3 calls this after transferring `amount` of `asset` to us.
     *         We must repay amount + premium before this function returns.
     */
    function executeOperation(
        address asset,          // loanToken
        uint256 amount,         // borrowed amount
        uint256 premium,        // AAVE fee (0.05% = 5 bps)
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Only AAVE pool can call this
        if (msg.sender != aavePool) revert NotAavePool();
        // Initiator must be this contract
        require(initiator == address(this), "bad initiator");

        (
            address buyDex,
            address sellDex,
            address profitToken,
            uint256 minProfit
        ) = abi.decode(params, (address, address, address, uint256));

        uint256 repayAmount = amount + premium;

        // ── Step 1: Swap loanToken → profitToken on buyDex ────────────────────
        uint256 profitTokenReceived = _swapExactIn(
            asset,
            profitToken,
            amount,
            buyDex
        );

        // ── Step 2: Swap profitToken → loanToken on sellDex ───────────────────
        uint256 loanTokenReceived = _swapExactIn(
            profitToken,
            asset,
            profitTokenReceived,
            sellDex
        );

        // ── Step 3: Oracle-free profit check ──────────────────────────────────
        // Net profit = what we got back minus what we must repay
        if (loanTokenReceived < repayAmount) {
            revert InsufficientRepayment();
        }
        uint256 netProfit = loanTokenReceived - repayAmount;

        uint256 effectiveMin = minProfit > minProfitWei ? minProfit : minProfitWei;
        if (netProfit < effectiveMin) {
            revert ProfitBelowMinimum(netProfit, effectiveMin);
        }

        // ── Step 4: Approve AAVE to pull repayment ────────────────────────────
        IERC20(asset).approve(aavePool, repayAmount);

        // ── Step 5: Send profit to profitWallet ───────────────────────────────
        IERC20(asset).transfer(profitWallet, netProfit);

        emit ArbExecuted(asset, amount, netProfit, buyDex, sellDex);
        return true;
    }

    // ── Internal: Oracle-free Uniswap V2 Swap ─────────────────────────────────

    /**
     * @dev Executes an exact-input swap on a Uniswap V2 pair.
     *      Uses the pair's own reserves to compute the output — no oracle needed.
     *      Returns the actual amount of tokenOut received.
     */
    function _swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address pair
    ) internal returns (uint256 amountOut) {
        IUniswapV2Pair dexPair = IUniswapV2Pair(pair);

        // Determine token ordering in the pair
        address token0 = dexPair.token0();
        bool zeroForOne = (tokenIn == token0);

        // Read current reserves
        (uint112 reserve0, uint112 reserve1,) = dexPair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));

        // Uniswap V2 formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);

        // Transfer tokenIn to the pair
        IERC20(tokenIn).transfer(pair, amountIn);

        // Execute the swap
        (uint256 amount0Out, uint256 amount1Out) = zeroForOne
            ? (uint256(0), amountOut)
            : (amountOut, uint256(0));

        dexPair.swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    // ── Owner Controls ─────────────────────────────────────────────────────────

    function setProfitWallet(address _wallet) external onlyOwner {
        if (_wallet == address(0)) revert ZeroAddress();
        profitWallet = _wallet;
    }

    function setMinProfit(uint256 _minProfitWei) external onlyOwner {
        minProfitWei = _minProfitWei;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    /**
     * @notice Emergency withdraw any token stuck in this contract.
     */
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
        emit ProfitWithdrawn(token, amount, owner);
    }

    /// @notice Reject plain ETH sends
    receive() external payable { revert("no ETH"); }
}
