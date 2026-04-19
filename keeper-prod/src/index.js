import express from 'express';
import { ethers } from 'ethers';
import zmq from 'zmq';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const ELITE_ANT_ADDRESS = process.env.ELITE_ANT_ADDRESS || '0x...';
const MIN_PROFIT_USD = parseFloat(process.env.MIN_PROFIT_USD || '5');
const MAX_SLIPPAGE_PCT = parseFloat(process.env.MAX_SLIPPAGE_PCT || '0.5');
const MAX_VOLATILITY_PCT = parseFloat(process.env.MAX_VOLATILITY_PCT || '5');
const MAX_GAS_GWEI = parseFloat(process.env.MAX_GAS_GWEI || '100');

const POLYGON_RPC = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

// ============================================================================
// STATE
// ============================================================================

let state = {
  connected: false,
  opportunities_received: 0,
  trades_executed: 0,
  trades: [],
  last_opportunity: null,
};

// ============================================================================
// SETUP
// ============================================================================

const app = express();
app.use(express.json());

// Ethers provider and signer
const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

console.log(`[KEEPER] Signer address: ${signer.address}`);

// ZeroMQ PULL socket
const sock = new zmq.Pull();

// ============================================================================
// RISK ENGINE
// ============================================================================

async function validateRisk(opportunity) {
  try {
    // 1. Get current gas price
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
    
    if (gasPriceGwei > MAX_GAS_GWEI) {
      return { valid: false, reason: `Gas price ${gasPriceGwei} Gwei exceeds max ${MAX_GAS_GWEI}` };
    }

    // 2. Check slippage
    if (opportunity.spread_pct < MAX_SLIPPAGE_PCT) {
      return { valid: false, reason: `Spread ${opportunity.spread_pct}% below min threshold` };
    }

    // 3. Check profit
    if (opportunity.expected_profit_usd < MIN_PROFIT_USD) {
      return { valid: false, reason: `Profit $${opportunity.expected_profit_usd} below min $${MIN_PROFIT_USD}` };
    }

    // 4. Estimate gas cost
    const estimatedGas = 300000n; // Flash loan + 2 swaps
    const gasCostWei = gasPrice * estimatedGas;
    const gasCostUSD = parseFloat(ethers.formatUnits(gasCostWei, 'ether')) * 1.5; // Rough MATIC to USD

    if (gasCostUSD > opportunity.expected_profit_usd * 0.5) {
      return { valid: false, reason: `Gas cost $${gasCostUSD.toFixed(2)} too high vs profit $${opportunity.expected_profit_usd.toFixed(2)}` };
    }

    return { valid: true, reason: 'All checks passed', gasCostUSD, gasPriceGwei };
  } catch (error) {
    return { valid: false, reason: `Risk validation error: ${error.message}` };
  }
}

// ============================================================================
// TRADE EXECUTION
// ============================================================================

async function executeArbitrage(opportunity) {
  try {
    console.log(`[KEEPER] Executing arbitrage: ${opportunity.pair}`);

    // Build transaction
    const tx = {
      to: ELITE_ANT_ADDRESS,
      data: buildFlashLoanCalldata(opportunity),
      gasLimit: 300000n,
      gasPrice: await provider.getGasPrice(),
    };

    // Send transaction
    console.log(`[KEEPER] Sending transaction...`);
    const txResponse = await signer.sendTransaction(tx);
    console.log(`[KEEPER] Tx sent: ${txResponse.hash}`);

    // Wait for confirmation
    const receipt = await txResponse.wait();
    
    if (receipt.status === 1) {
      console.log(`[KEEPER] Trade successful! Tx: ${receipt.hash}`);
      
      const trade = {
        id: receipt.hash,
        timestamp: new Date().toISOString(),
        pair: opportunity.pair,
        dex_a: opportunity.dex_a,
        dex_b: opportunity.dex_b,
        spread_pct: opportunity.spread_pct,
        expected_profit_usd: opportunity.expected_profit_usd,
        status: 'success',
        tx_hash: receipt.hash,
        gas_used: receipt.gasUsed.toString(),
      };

      state.trades.push(trade);
      state.trades_executed += 1;
      
      return trade;
    } else {
      console.error(`[KEEPER] Trade failed!`);
      return { status: 'failed', reason: 'Transaction reverted' };
    }
  } catch (error) {
    console.error(`[KEEPER] Execution error: ${error.message}`);
    return { status: 'error', reason: error.message };
  }
}

function buildFlashLoanCalldata(opportunity) {
  // Placeholder: would encode EliteAntArb.executeArb() calldata
  // For now, return dummy data
  return '0x'; // TODO: implement proper encoding
}

// ============================================================================
// ZMQ LISTENER
// ============================================================================

async function startZMQListener() {
  await sock.bind('tcp://127.0.0.1:5555');
  console.log('[KEEPER] ZMQ PULL socket listening on tcp://127.0.0.1:5555');

  for await (const [msg] of sock) {
    try {
      const opportunity = JSON.parse(msg.toString());
      console.log(`[KEEPER] Received opportunity: ${opportunity.pair} spread=${opportunity.spread_pct.toFixed(2)}%`);

      state.opportunities_received += 1;
      state.last_opportunity = opportunity;

      // Validate risk
      const riskCheck = await validateRisk(opportunity);
      console.log(`[KEEPER] Risk check: ${riskCheck.valid ? 'PASS' : 'FAIL'} - ${riskCheck.reason}`);

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
    opportunities_received: state.opportunities_received,
    trades_executed: state.trades_executed,
    last_opportunity: state.last_opportunity,
    signer_address: signer.address,
  });
});

app.get('/trades', (req, res) => {
  res.json(state.trades.slice(-50));
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

// ============================================================================
// STARTUP
// ============================================================================

async function main() {
  console.log('[KEEPER] Starting Elite Keeper...');
  console.log(`[KEEPER] Polygon RPC: ${POLYGON_RPC}`);
  console.log(`[KEEPER] Signer: ${signer.address}`);
  console.log(`[KEEPER] Min profit: $${MIN_PROFIT_USD}`);
  console.log(`[KEEPER] Max slippage: ${MAX_SLIPPAGE_PCT}%`);
  console.log(`[KEEPER] Max gas: ${MAX_GAS_GWEI} Gwei`);

  // Start ZMQ listener
  startZMQListener().catch(console.error);

  // Start HTTP server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[KEEPER] HTTP API listening on port ${PORT}`);
    state.connected = true;
  });
}

main().catch(console.error);
