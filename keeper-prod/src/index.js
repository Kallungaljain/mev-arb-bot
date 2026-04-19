import express from 'express';
import { ethers } from 'ethers';
import zmq from 'zmq';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const ELITE_ANT_ADDRESS = process.env.ELITE_ANT_ADDRESS || '';
const MIN_PROFIT_USD = parseFloat(process.env.MIN_PROFIT_USD || '5');
const MAX_SLIPPAGE_PCT = parseFloat(process.env.MAX_SLIPPAGE_PCT || '0.5');
const MAX_GAS_GWEI = parseFloat(process.env.MAX_GAS_GWEI || '100');

const POLYGON_RPC = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

// Uniswap V2 Router addresses
const QUICKSWAP_ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';
const SUSHISWAP_ROUTER = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';

// Token addresses
const WMATIC = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const WETH = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';

// AAVE V3 Flash Loan Provider
const AAVE_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

// ============================================================================
// STATE
// ============================================================================

let state = {
  connected: false,
  opportunities_received: 0,
  trades_executed: 0,
  trades_success: 0,
  trades_failed: 0,
  trades: [],
  last_opportunity: null,
};

// ============================================================================
// SETUP
// ============================================================================

const app = express();
app.use(express.json());

const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

console.log(`[KEEPER] Signer address: ${signer.address}`);

// ZeroMQ PULL socket
const sock = new zmq.Pull();

// ============================================================================
// UNISWAP V2 ABI (minimal for swaps)
// ============================================================================

const UNISWAP_V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// ============================================================================
// RISK ENGINE
// ============================================================================

async function validateRisk(opportunity) {
  try {
    // 1. Get current gas price
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
    
    if (gasPriceGwei > MAX_GAS_GWEI) {
      return { valid: false, reason: `Gas price ${gasPriceGwei.toFixed(2)} Gwei exceeds max ${MAX_GAS_GWEI}` };
    }

    // 2. Check spread
    if (opportunity.spread_pct < 0.3) {
      return { valid: false, reason: `Spread ${opportunity.spread_pct.toFixed(3)}% too small` };
    }

    // 3. Check profit
    if (opportunity.expected_profit_usd < MIN_PROFIT_USD) {
      return { valid: false, reason: `Profit $${opportunity.expected_profit_usd.toFixed(2)} below min $${MIN_PROFIT_USD}` };
    }

    // 4. Estimate gas cost
    const estimatedGas = 400000n; // Flash loan + 2 swaps + overhead
    const gasCostWei = gasPrice * estimatedGas;
    const gasCostUSD = parseFloat(ethers.formatUnits(gasCostWei, 'ether')) * 1.5; // MATIC to USD estimate

    if (gasCostUSD > opportunity.expected_profit_usd * 0.5) {
      return { valid: false, reason: `Gas cost $${gasCostUSD.toFixed(2)} too high vs profit $${opportunity.expected_profit_usd.toFixed(2)}` };
    }

    return { 
      valid: true, 
      reason: 'All checks passed', 
      gasCostUSD: gasCostUSD.toFixed(2), 
      gasPriceGwei: gasPriceGwei.toFixed(2),
      estimatedGas: estimatedGas.toString()
    };
  } catch (error) {
    return { valid: false, reason: `Risk validation error: ${error.message}` };
  }
}

// ============================================================================
// TRADE EXECUTION
// ============================================================================

async function executeArbitrage(opportunity) {
  try {
    console.log(`[KEEPER] 🚀 Executing: ${opportunity.pair} spread=${opportunity.spread_pct.toFixed(3)}%`);

    // Get current gas price
    const gasPrice = await provider.getGasPrice();
    
    // Estimate gas
    const estimatedGas = 400000n;

    // Build transaction
    const tx = {
      to: ELITE_ANT_ADDRESS,
      data: buildFlashLoanCalldata(opportunity),
      gasLimit: estimatedGas,
      gasPrice: gasPrice,
      value: 0n,
    };

    console.log(`[KEEPER] Sending transaction...`);
    const txResponse = await signer.sendTransaction(tx);
    console.log(`[KEEPER] ✓ Tx sent: ${txResponse.hash}`);

    // Wait for confirmation (1 block)
    const receipt = await txResponse.wait(1);
    
    if (receipt && receipt.status === 1) {
      console.log(`[KEEPER] ✅ Trade successful!`);
      
      const gasUsed = receipt.gasUsed;
      const gasCost = gasUsed * gasPrice;
      const gasCostUSD = parseFloat(ethers.formatUnits(gasCost, 'ether')) * 1.5;

      const trade = {
        id: receipt.hash,
        timestamp: new Date().toISOString(),
        pair: opportunity.pair,
        spread_pct: opportunity.spread_pct,
        expected_profit_usd: opportunity.expected_profit_usd,
        gas_used: gasUsed.toString(),
        gas_cost_usd: gasCostUSD.toFixed(2),
        status: 'success',
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber,
      };

      state.trades.push(trade);
      state.trades_executed += 1;
      state.trades_success += 1;
      
      return trade;
    } else {
      console.error(`[KEEPER] ❌ Trade failed: transaction reverted`);
      state.trades_failed += 1;
      return { status: 'failed', reason: 'Transaction reverted', tx_hash: receipt?.hash };
    }
  } catch (error) {
    console.error(`[KEEPER] ❌ Execution error: ${error.message}`);
    state.trades_failed += 1;
    return { status: 'error', reason: error.message };
  }
}

// ============================================================================
// FLASH LOAN CALLDATA ENCODING
// ============================================================================

function buildFlashLoanCalldata(opportunity) {
  try {
    // This would encode the EliteAntArb.executeArb() function call
    // For now, return a placeholder that would be replaced with actual encoding
    
    // In production, this would be:
    // const iface = new ethers.Interface(ELITE_ANT_ABI);
    // return iface.encodeFunctionData('executeArb', [
    //   tokenBorrow,
    //   amountBorrow,
    //   tokenSwap,
    //   minProfit
    // ]);

    // Placeholder: return empty calldata (would fail on-chain)
    return '0x';
  } catch (error) {
    console.error(`[KEEPER] Error building calldata: ${error.message}`);
    return '0x';
  }
}

// ============================================================================
// ZMQ LISTENER
// ============================================================================

async function startZMQListener() {
  await sock.bind('tcp://127.0.0.1:5555');
  console.log('[KEEPER] ✓ ZMQ PULL socket listening on tcp://127.0.0.1:5555');

  for await (const [msg] of sock) {
    try {
      const opportunity = JSON.parse(msg.toString());
      console.log(`[KEEPER] 📊 Received: ${opportunity.pair} spread=${opportunity.spread_pct.toFixed(3)}% profit=$${opportunity.expected_profit_usd.toFixed(2)}`);

      state.opportunities_received += 1;
      state.last_opportunity = opportunity;

      // Validate risk
      const riskCheck = await validateRisk(opportunity);
      console.log(`[KEEPER] ${riskCheck.valid ? '✅' : '❌'} Risk check: ${riskCheck.reason}`);

      if (riskCheck.valid) {
        // Execute trade
        const result = await executeArbitrage(opportunity);
        console.log(`[KEEPER] Trade result:`, result);
      }
    } catch (error) {
      console.error('[KEEPER] Error processing opportunity:', error.message);
    }
  }
}

// ============================================================================
// HTTP API
// ============================================================================

app.get('/status', (req, res) => {
  res.json({
    connected: state.connected,
    signer_address: signer.address,
    opportunities_received: state.opportunities_received,
    trades_executed: state.trades_executed,
    trades_success: state.trades_success,
    trades_failed: state.trades_failed,
    success_rate: state.trades_executed > 0 ? ((state.trades_success / state.trades_executed) * 100).toFixed(2) + '%' : 'N/A',
    last_opportunity: state.last_opportunity,
  });
});

app.get('/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(state.trades.slice(-limit));
});

app.get('/opportunities', (req, res) => {
  res.json({
    last: state.last_opportunity,
    total_received: state.opportunities_received,
  });
});

app.post('/execute', async (req, res) => {
  const { opportunity } = req.body;
  
  if (!opportunity) {
    return res.status(400).json({ error: 'No opportunity provided' });
  }

  const riskCheck = await validateRisk(opportunity);
  if (!riskCheck.valid) {
    return res.status(400).json({ error: riskCheck.reason });
  }

  const result = await executeArbitrage(opportunity);
  res.json(result);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// STARTUP
// ============================================================================

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          ELITE MEV ARBITRAGE KEEPER                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`[KEEPER] Polygon RPC: ${POLYGON_RPC.substring(0, 50)}...`);
  console.log(`[KEEPER] Signer: ${signer.address}`);
  console.log(`[KEEPER] Min profit: $${MIN_PROFIT_USD}`);
  console.log(`[KEEPER] Max slippage: ${MAX_SLIPPAGE_PCT}%`);
  console.log(`[KEEPER] Max gas: ${MAX_GAS_GWEI} Gwei`);
  console.log('');

  // Start ZMQ listener
  startZMQListener().catch(console.error);

  // Start HTTP server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[KEEPER] ✓ HTTP API listening on port ${PORT}`);
    console.log(`[KEEPER] Status: http://localhost:${PORT}/status`);
    console.log(`[KEEPER] Trades: http://localhost:${PORT}/trades`);
    console.log('');
    state.connected = true;
  });
}

main().catch(console.error);
