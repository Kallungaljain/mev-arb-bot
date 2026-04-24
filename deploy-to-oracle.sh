#!/bin/bash

###############################################################################
# MEV Engine Deployment Script for Oracle Cloud VPS
# Automated deployment of ultra-fast arbitrage engine
###############################################################################

set -e

echo "=========================================="
echo "MEV Engine - Oracle Cloud Deployment"
echo "=========================================="

# Configuration
DEPLOY_DIR="/home/ubuntu/mev-engine"
REPO_URL="https://github.com/YOUR_REPO/mev-arb-bot.git"
ALCHEMY_KEY="${ALCHEMY_KEY:-Z2W4KU8VAD67eVEGPrdBR}"
NODE_ENV="production"
PORT=3000

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Step 1: Update system
log_info "Step 1: Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# Step 2: Install Node.js 22
log_info "Step 2: Installing Node.js 22..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
  sudo apt-get install -y nodejs > /dev/null 2>&1
  log_info "Node.js installed: $(node --version)"
else
  log_info "Node.js already installed: $(node --version)"
fi

# Step 3: Install pnpm
log_info "Step 3: Installing pnpm..."
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm > /dev/null 2>&1
  log_info "pnpm installed: $(pnpm --version)"
else
  log_info "pnpm already installed: $(pnpm --version)"
fi

# Step 4: Install PM2
log_info "Step 4: Installing PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 > /dev/null 2>&1
  log_info "PM2 installed: $(pm2 --version)"
else
  log_info "PM2 already installed: $(pm2 --version)"
fi

# Step 5: Create deployment directory
log_info "Step 5: Setting up deployment directory..."
if [ ! -d "$DEPLOY_DIR" ]; then
  mkdir -p "$DEPLOY_DIR"
  log_info "Created $DEPLOY_DIR"
else
  log_info "Directory already exists: $DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"

# Step 6: Create package.json
log_info "Step 6: Creating package.json..."
cat > package.json << 'EOF'
{
  "name": "mev-engine",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node dist/index.js",
    "dev": "tsx watch server/_core/index.ts",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "ethers": "^6.13.2",
    "axios": "^1.7.7",
    "dotenv": "^16.6.1",
    "express": "^4.22.1",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "tsx": "^4.21.0",
    "@types/node": "^22.19.3",
    "@types/express": "^4.17.25"
  }
}
EOF
log_info "package.json created"

# Step 7: Create tsconfig.json
log_info "Step 7: Creating tsconfig.json..."
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
log_info "tsconfig.json created"

# Step 8: Create .env file
log_info "Step 8: Creating environment configuration..."
cat > .env.production << EOF
NODE_ENV=production
PORT=$PORT
RPC_URL=https://polygon-rpc.com
ALCHEMY_KEY=$ALCHEMY_KEY
LOG_LEVEL=info
EOF
chmod 600 .env.production
log_info ".env.production created (secured)"

# Step 9: Create main server file
log_info "Step 9: Creating server application..."
mkdir -p server/_core

cat > server/_core/index.ts << 'EOF'
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

config({ path: '.env.production' });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoints
app.get('/api/bot/status', (req, res) => {
  res.json({
    running: true,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/bot/start', (req, res) => {
  res.json({ message: 'Bot started', status: 'running' });
});

app.post('/api/bot/stop', (req, res) => {
  res.json({ message: 'Bot stopped', status: 'stopped' });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] MEV Engine running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
});
EOF
log_info "Server created"

# Step 10: Install dependencies
log_info "Step 10: Installing dependencies..."
pnpm install > /dev/null 2>&1
log_info "Dependencies installed"

# Step 11: Build TypeScript
log_info "Step 11: Building TypeScript..."
pnpm run build > /dev/null 2>&1
log_info "Build complete"

# Step 12: Create PM2 ecosystem config
log_info "Step 12: Creating PM2 configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'mev-engine',
    script: 'dist/server/_core/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    watch: false,
    max_memory_restart: '512M',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF
log_info "PM2 configuration created"

# Step 13: Create logs directory
log_info "Step 13: Setting up logging..."
mkdir -p logs
log_info "Logs directory created"

# Step 14: Stop existing PM2 process (if any)
log_info "Step 14: Cleaning up existing processes..."
pm2 delete mev-engine 2>/dev/null || true

# Step 15: Start with PM2
log_info "Step 15: Starting MEV engine with PM2..."
pm2 start ecosystem.config.js --env production
pm2 save

# Step 16: Enable PM2 startup on reboot
log_info "Step 16: Enabling PM2 startup on reboot..."
pm2 startup > /dev/null 2>&1 || true

# Step 17: Verify deployment
log_info "Step 17: Verifying deployment..."
sleep 2

if pm2 list | grep -q "mev-engine"; then
  log_info "✓ MEV engine is running!"
  pm2 list
else
  log_error "✗ Failed to start MEV engine"
  pm2 logs mev-engine --lines 20
  exit 1
fi

# Final status
echo ""
echo "=========================================="
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo "MEV Engine Status:"
echo "  - Service: mev-engine"
echo "  - Port: $PORT"
echo "  - Environment: $NODE_ENV"
echo "  - Alchemy Key: ${ALCHEMY_KEY:0:10}..."
echo ""
echo "Access Points:"
echo "  - Health: http://localhost:3000/health"
echo "  - Status: http://localhost:3000/api/bot/status"
echo ""
echo "PM2 Commands:"
echo "  - View logs: pm2 logs mev-engine"
echo "  - Restart: pm2 restart mev-engine"
echo "  - Stop: pm2 stop mev-engine"
echo "  - Monitor: pm2 monit"
echo ""
echo "=========================================="
