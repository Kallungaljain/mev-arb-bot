#!/bin/bash

# MEV Supercolony VPS Deployment Script
# Run this in your Oracle Cloud Shell

set -e

echo "🚀 Starting MEV Supercolony Deployment..."
echo "=========================================="

# Step 1: Update system
echo "📦 Step 1: Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Step 2: Install Rust
echo "🦀 Step 2: Installing Rust..."
if ! command -v rustc &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
else
    echo "✅ Rust already installed"
fi

# Step 3: Install dependencies
echo "📚 Step 3: Installing dependencies..."
sudo apt install -y build-essential pkg-config libssl-dev git curl

# Step 4: Clone repository
echo "📥 Step 4: Cloning MEV supercolony repository..."
cd /home/ubuntu
if [ -d "mev-arb-bot" ]; then
    echo "Repository already exists, pulling latest..."
    cd mev-arb-bot
    git pull origin main
else
    git clone https://github.com/kallungaljain/mev-arb-bot.git
    cd mev-arb-bot
fi

# Step 5: Build Rust supercolony
echo "🔨 Step 5: Building MEV supercolony (this may take 5-10 minutes)..."
cd supercolony_rust
cargo build --release

# Step 6: Create .env file
echo "⚙️  Step 6: Creating configuration file..."
cat > .env << 'EOF'
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
EOF

echo "⚠️  IMPORTANT: Edit .env with your actual configuration:"
echo "   - ALCHEMY_API_KEY: Your Alchemy API key"
echo "   - DEPLOYER_PRIVATE_KEY: Your wallet private key"
echo "   - PROFIT_WALLET: Your profit wallet address"
echo "   - FLASH_LOAN_CONTRACT: Balancer receiver contract address"

# Step 7: Create systemd service
echo "🔧 Step 7: Creating systemd service..."
sudo tee /etc/systemd/system/mev-supercolony.service > /dev/null << EOF
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
EOF

sudo systemctl daemon-reload
sudo systemctl enable mev-supercolony

# Step 8: Create monitoring script
echo "📊 Step 8: Creating monitoring script..."
cat > /home/ubuntu/monitor_bot.sh << 'EOF'
#!/bin/bash
while true; do
  clear
  echo "=== MEV SUPERCOLONY STATUS ==="
  echo "Service Status:"
  sudo systemctl status mev-supercolony --no-pager | head -5
  echo ""
  echo "Performance Metrics:"
  curl -s http://localhost:8080/metrics 2>/dev/null | grep -E "profit|success_rate|routes" || echo "Metrics not available yet"
  echo ""
  echo "Recent Logs (last 10 lines):"
  sudo journalctl -u mev-supercolony -n 10 --no-pager
  echo ""
  echo "Press Ctrl+C to stop monitoring"
  sleep 10
done
EOF
chmod +x /home/ubuntu/monitor_bot.sh

# Step 9: Summary
echo ""
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "📋 Next Steps:"
echo "1. Edit .env file with your configuration:"
echo "   nano /home/ubuntu/mev-arb-bot/supercolony_rust/.env"
echo ""
echo "2. Start the bot:"
echo "   sudo systemctl start mev-supercolony"
echo ""
echo "3. Check status:"
echo "   sudo systemctl status mev-supercolony"
echo ""
echo "4. View logs:"
echo "   sudo journalctl -u mev-supercolony -f"
echo ""
echo "5. Monitor performance:"
echo "   /home/ubuntu/monitor_bot.sh"
echo ""
echo "6. Verify bot is running:"
echo "   curl http://localhost:8080/metrics"
echo ""
echo "=========================================="
echo "🚀 Your MEV supercolony is ready to trade!"
echo ""
