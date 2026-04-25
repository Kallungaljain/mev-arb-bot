# 🚀 PRODUCTION DEPLOYMENT CHECKLIST - MEV SUPERCOLONY

## Pre-Deployment Setup

### 1. Oracle Cloud VPS Setup (30 minutes)
- [ ] Create Oracle Cloud account (Always Free Tier)
- [ ] Create Compute Instance (Ubuntu 22.04, 4 OCPU, 24GB RAM)
- [ ] Configure security groups (allow ports 22, 8080, 8081)
- [ ] Create SSH key pair
- [ ] SSH into instance: `ssh ubuntu@<instance_ip>`

### 2. Environment Setup (20 minutes)
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install dependencies
sudo apt install -y build-essential pkg-config libssl-dev

# Verify installation
rustc --version
cargo --version
```

### 3. Clone and Build (15 minutes)
```bash
# Clone repository
git clone https://github.com/yourusername/mev-arb-bot.git
cd mev-arb-bot/supercolony_rust

# Build release binary
cargo build --release

# Binary location: target/release/supercolony_rust
```

### 4. Configuration (10 minutes)

Create `.env` file:
```bash
# Blockchain Configuration
ALCHEMY_API_KEY=your_alchemy_key_here
POLYGON_RPC=https://polygon-rpc.com
CHAIN_ID=137

# Wallet Configuration
DEPLOYER_PRIVATE_KEY=your_private_key_here
PROFIT_WALLET=0xyour_profit_wallet_here
FLASH_LOAN_CONTRACT=0x_balancer_receiver_contract

# Bot Configuration
MIN_PROFIT_THRESHOLD=1000000000000000
NUM_SCOUTS=3
NUM_EXECUTORS=5
CAPITAL_PER_EXECUTOR=10000000000000000000
REBALANCE_INTERVAL_SECS=5
META_OPTIMIZATION_INTERVAL_SECS=300

# Monitoring
LOG_LEVEL=info
METRICS_PORT=8080
```

### 5. Smart Contract Deployment (30 minutes)

Deploy Balancer Flash Loan Receiver:
```bash
cd ../contracts

# Create .env
cat > .env << EOF
ALCHEMY_API_KEY=your_alchemy_key
DEPLOYER_PRIVATE_KEY=your_private_key
PROFIT_ADDRESS=0xyour_address
POLYGONSCAN_API_KEY=your_polygonscan_key
EOF

# Deploy
npx hardhat run scripts/deploy-balancer.ts --network polygon

# Save contract address from output
# Update in supercolony_rust/.env as FLASH_LOAN_CONTRACT
```

### 6. Systemd Service Setup (10 minutes)

Create `/etc/systemd/system/mev-supercolony.service`:
```ini
[Unit]
Description=MEV Supercolony Arbitrage Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mev-arb-bot/supercolony_rust
EnvironmentFile=/home/ubuntu/mev-arb-bot/supercolony_rust/.env
ExecStart=/home/ubuntu/mev-arb-bot/supercolony_rust/target/release/supercolony_rust
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mev-supercolony
sudo systemctl start mev-supercolony
```

### 7. Monitoring Setup (15 minutes)

```bash
# Check service status
sudo systemctl status mev-supercolony

# View logs
sudo journalctl -u mev-supercolony -f

# Check metrics
curl http://localhost:8080/metrics

# Monitor performance
watch -n 1 'curl -s http://localhost:8080/metrics | grep profit'
```

### 8. Wallet Funding (5 minutes)

Fund your deployer wallet with MATIC:
```bash
# Send 10 MATIC to deployer wallet for gas
# Use any exchange or faucet

# Verify balance
cast balance 0xyour_deployer_address --rpc-url https://polygon-rpc.com

# Send 1 MATIC to profit wallet as initial capital
# This will be used for flash loans
```

### 9. Initial Capital Setup (10 minutes)

```bash
# Send initial capital to bot wallet
# Recommended: Start with 1-10 MATIC

# Monitor capital usage
curl http://localhost:8080/metrics | grep capital

# Watch profit accumulation
watch -n 5 'curl -s http://localhost:8080/metrics | grep profit'
```

### 10. Validation & Testing (30 minutes)

```bash
# Check bot is running
sudo systemctl status mev-supercolony

# Verify scouts are discovering routes
sudo journalctl -u mev-supercolony -f | grep "route discovered"

# Verify executors are trading
sudo journalctl -u mev-supercolony -f | grep "trade executed"

# Monitor profit growth
watch -n 10 'curl -s http://localhost:8080/metrics | grep -E "profit|success_rate"'

# Check for errors
sudo journalctl -u mev-supercolony -f | grep -i error
```

---

## Post-Deployment Operations

### Daily Monitoring
```bash
# Check service health
sudo systemctl status mev-supercolony

# View performance metrics
curl http://localhost:8080/metrics

# Monitor logs for errors
sudo journalctl -u mev-supercolony --since "1 hour ago" | grep -i error
```

### Weekly Maintenance
```bash
# Withdraw profits
# Script to transfer profits to personal wallet
./scripts/withdraw_profits.sh

# Check capital allocation
curl http://localhost:8080/metrics | grep capital

# Verify all workers are active
curl http://localhost:8080/metrics | grep worker_active
```

### Monthly Optimization
```bash
# Review performance statistics
curl http://localhost:8080/stats

# Analyze route profitability
curl http://localhost:8080/routes | jq '.[] | select(.profit > 0)'

# Tune parameters if needed
# Edit .env and restart service
sudo systemctl restart mev-supercolony
```

---

## Troubleshooting

### Service Won't Start
```bash
# Check logs
sudo journalctl -u mev-supercolony -n 50

# Verify .env file exists and is readable
ls -la /home/ubuntu/mev-arb-bot/supercolony_rust/.env

# Check permissions
sudo chown ubuntu:ubuntu /home/ubuntu/mev-arb-bot/supercolony_rust/.env
sudo chmod 600 /home/ubuntu/mev-arb-bot/supercolony_rust/.env
```

### No Trades Executing
```bash
# Check if scouts are discovering routes
sudo journalctl -u mev-supercolony -f | grep "route"

# Verify wallet has MATIC for gas
cast balance 0xyour_wallet --rpc-url https://polygon-rpc.com

# Check flash loan contract is deployed
curl https://polygonscan.com/api?module=contract&action=getabi&address=0xyour_contract

# Verify Alchemy API key is valid
curl -X POST https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### High Gas Costs
```bash
# Check gas price multiplier
curl http://localhost:8080/metrics | grep gas_multiplier

# Reduce if too high (edit .env)
# Restart service
sudo systemctl restart mev-supercolony
```

### Capital Not Growing
```bash
# Check success rate
curl http://localhost:8080/metrics | grep success_rate

# If <80%, capital allocation may be suboptimal
# Check executor performance
curl http://localhost:8080/metrics | grep executor_profit

# Verify MIN_PROFIT_THRESHOLD is reasonable
# Too high = no trades, too low = unprofitable trades
```

---

## Performance Targets

### Week 1 (Testing Phase)
- [ ] Bot running stably
- [ ] Scouts discovering 50+ routes/hour
- [ ] Executors executing 5-10 trades/hour
- [ ] Success rate >80%
- [ ] Profit: $100-500/day

### Week 2 (Optimization Phase)
- [ ] Scouts discovering 100+ routes/hour
- [ ] Executors executing 20-30 trades/hour
- [ ] Success rate >90%
- [ ] Profit: $500-1000/day

### Week 3+ (Scaling Phase)
- [ ] Scouts discovering 200+ routes/hour
- [ ] Executors executing 50+ trades/hour
- [ ] Success rate >95%
- [ ] Profit: $1000-5000+/day
- [ ] Ready to expand capital

---

## Security Checklist

- [ ] Private key stored in .env (never in code)
- [ ] .env file permissions: 600 (readable only by owner)
- [ ] SSH key protected with passphrase
- [ ] Firewall configured (only necessary ports open)
- [ ] Regular backups of .env and wallet data
- [ ] Monitor for unauthorized access attempts
- [ ] Use hardware wallet for profit withdrawal
- [ ] Enable 2FA on all accounts

---

## Scaling Checklist

### After First Week of Profit
- [ ] Increase capital allocation by 50%
- [ ] Add 2 more scout workers
- [ ] Add 2 more executor workers
- [ ] Monitor performance impact

### After First Month of Profit
- [ ] Deploy to Ethereum mainnet
- [ ] Deploy to Arbitrum
- [ ] Deploy to Optimism
- [ ] Consolidate profits

### After First Quarter
- [ ] Evaluate professional hosting
- [ ] Consider dedicated hardware
- [ ] Implement advanced monitoring
- [ ] Plan for 10x capital scaling

---

## Final Checklist

- [ ] Oracle Cloud VPS created and configured
- [ ] Rust installed and verified
- [ ] Repository cloned and built
- [ ] .env file created with all keys
- [ ] Smart contract deployed
- [ ] Systemd service configured
- [ ] Wallet funded with MATIC
- [ ] Service started and running
- [ ] Scouts discovering routes
- [ ] Executors executing trades
- [ ] Profits accumulating
- [ ] Monitoring in place
- [ ] Ready for scaling

---

## Support & Monitoring

### Real-Time Monitoring Dashboard
```bash
# Create monitoring script
cat > monitor.sh << 'EOF'
#!/bin/bash
while true; do
  clear
  echo "=== MEV SUPERCOLONY STATUS ==="
  echo "Service Status:"
  sudo systemctl status mev-supercolony --no-pager | head -5
  echo ""
  echo "Performance Metrics:"
  curl -s http://localhost:8080/metrics | grep -E "profit|success_rate|routes_discovered|trades_executed"
  echo ""
  echo "Recent Logs:"
  sudo journalctl -u mev-supercolony -n 5 --no-pager
  sleep 10
done
EOF

chmod +x monitor.sh
./monitor.sh
```

### Alert System
```bash
# Send alerts on errors
sudo journalctl -u mev-supercolony -f | while read line; do
  if echo "$line" | grep -i "error\|failed"; then
    # Send alert (email, Slack, etc)
    echo "Alert: $line" | mail -s "MEV Bot Error" your@email.com
  fi
done
```

---

## You're Ready! 🚀

Your MEV supercolony is ready to deploy and start earning passive income on Polygon mainnet.

**Expected Results:**
- Week 1: $100-500/day
- Week 2: $500-1000/day
- Week 3+: $1000-5000+/day

**Good luck! Happy arbitraging!** 🐜💰
