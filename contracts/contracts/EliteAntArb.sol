// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EliteAntArb
 * @notice Oracle-free flash loan arbitrage contract for Polygon
 * 
 * This contract executes atomic arbitrage using AAVE V3 flash loans:
 * 1. Borrow token from AAVE
 * 2. Swap on DEX A (buy intermediate token)
 * 3. Swap on DEX B (sell intermediate token back)
 * 4. Repay AAVE (principal + 0.05% fee)
 * 5. Transfer profit to owner
 * 
 * All prices are oracle-free: calculated from actual pool reserves using x*y=k
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

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

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// ─── EliteAntArb ──────────────────────────────────────────────────────────────

contract EliteAntArb is IFlashLoanSimpleReceiver {

    // ── State ──────────────────────────────────────────────────────────────────

    address public immutable owner;
    address public immutable aavePool;
    address public profitWallet;
    uint256 public minProfitWei;
    bool public paused;

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

    constructor(
        address _aavePool,
        address _profitWallet,
        uint256 _minProfitWei
    ) {
        if (_aavePool == address(0) || _profitWallet == address(0)) revert ZeroAddress();
        owner = msg.sender;
        aavePool = _aavePool;
        profitWallet = _profitWallet;
        minProfitWei = _minProfitWei;
    }

    // ── External: Keeper Entry Point ───────────────────────────────────────────

    /**
     * @notice Called by Keeper to execute flash loan arbitrage
     * @param loanToken Token to borrow (e.g., USDC)
     * @param loanAmount Amount to borrow
     * @param buyDex Uniswap V2 pair to buy on
     * @param sellDex Uniswap V2 pair to sell on
     * @param profitToken Intermediate token (e.g., WMATIC)
     * @param minProfit Minimum acceptable profit
     */
    function executeArb(
        address loanToken,
        uint256 loanAmount,
        address buyDex,
        address sellDex,
        address profitToken,
        uint256 minProfit
    ) external notPaused {
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
            0
        );
    }

    // ── AAVE Callback ──────────────────────────────────────────────────────────

    /**
     * @notice AAVE calls this after transferring borrowed tokens
     * We must repay principal + premium before returning
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        if (msg.sender != aavePool) revert NotAavePool();
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

        // ── Step 3: Verify profit ──────────────────────────────────────────────
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
     * @dev Executes exact-input swap on Uniswap V2 pair
     * Uses x*y=k formula to calculate output from reserves
     */
    function _swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address pair
    ) internal returns (uint256 amountOut) {
        IUniswapV2Pair dexPair = IUniswapV2Pair(pair);

        address token0 = dexPair.token0();
        bool zeroForOne = (tokenIn == token0);

        (uint112 reserve0, uint112 reserve1,) = dexPair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));

        // Uniswap V2 formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);

        // Transfer tokenIn to pair
        IERC20(tokenIn).transfer(pair, amountIn);

        // Execute swap
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

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
        emit ProfitWithdrawn(token, amount, owner);
    }

    receive() external payable { revert("no ETH"); }
}
