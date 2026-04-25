#!/bin/bash

# MEV Supercolony - Oracle Cloud VPS Deployment
# Run this in your Oracle Cloud Shell

set -e

echo "🚀 MEV Supercolony Deployment Started"
echo "======================================"

# Step 1: Update system
echo "📦 Updating system..."
sudo apt update && sudo apt upgrade -y > /dev/null 2>&1

# Step 2: Install Rust
echo "🦀 Installing Rust..."
if ! command -v rustc &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y > /dev/null 2>&1
    source $HOME/.cargo/env
fi

# Step 3: Install dependencies
echo "📚 Installing dependencies..."
sudo apt install -y build-essential pkg-config libssl-dev git > /dev/null 2>&1

# Step 4: Clone repository
echo "📥 Cloning MEV supercolony..."
cd /tmp
rm -rf mev-arb-bot
git clone https://github.com/Kallungaljain/mev-arb-bot.git
cd mev-arb-bot/supercolony_rust

# Step 5: Build
echo "🔨 Building (this takes 10-15 minutes)..."
cargo build --release 2>&1 | tail -20

# Step 6: Setup
echo "⚙️  Setting up systemd service..."
sudo mkdir -p /opt/mev-supercolony
sudo cp target/release/supercolony_rust /opt/mev-supercolony/
sudo chown -R ubuntu:ubuntu /opt/mev-supercolony

# Create .env template
cat > /tmp/mev.env << 'EOF'
ALCHEMY_API_KEY=your_key_here
POLYGON_RPC=https://polygon-rpc.com
DEPLOYER_PRIVATE_KEY=your_key_here
PROFIT_WALLET=0xyour_address
FLASH_LOAN_CONTRACT=0xbalancer_contract
MIN_PROFIT_THRESHOLD=1000000000000000
NUM_SCOUTS=3
NUM_EXECUTORS=5
CAPITAL_PER_EXECUTOR=10000000000000000000
LOG_LEVEL=info
METRICS_PORT=8080
EOF

sudo cp /tmp/mev.env /opt/mev-supercolony/.env
sudo chown ubuntu:ubuntu /opt/mev-supercolony/.env
sudo chmod 600 /opt/mev-supercolony/.env

# Create systemd service
sudo tee /etc/systemd/system/mev-supercolony.service > /dev/null << 'EOF'
[Unit]
Description=MEV Supercolony Arbitrage Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mev-supercolony
EnvironmentFile=/opt/mev-supercolony/.env
ExecStart=/opt/mev-supercolony/supercolony_rust
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mev-supercolony

echo ""
echo "✅ Deployment Complete!"
echo "======================================"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Edit configuration:"
echo "   sudo nano /opt/mev-supercolony/.env"
echo ""
echo "2. Add your keys:"
echo "   - ALCHEMY_API_KEY"
echo "   - DEPLOYER_PRIVATE_KEY"
echo "   - PROFIT_WALLET"
echo "   - FLASH_LOAN_CONTRACT"
echo ""
echo "3. Start the bot:"
echo "   sudo systemctl start mev-supercolony"
echo ""
echo "4. Check status:"
echo "   sudo systemctl status mev-supercolony"
echo ""
echo "5. View logs:"
echo "   sudo journalctl -u mev-supercolony -f"
echo ""
echo "======================================"
echo "🚀 Your MEV supercolony is ready!"
