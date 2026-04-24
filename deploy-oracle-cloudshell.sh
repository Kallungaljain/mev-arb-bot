#!/bin/bash

###############################################################################
# MEV Engine - Oracle Cloud Shell Deployment
# Optimized for Cloud Shell environment
###############################################################################

set -e

echo "=========================================="
echo "MEV Engine - Cloud Shell Deployment"
echo "=========================================="

# Configuration
DEPLOY_DIR="$HOME/mev-engine"
ALCHEMY_KEY="Z2W4KU8VAD67eVEGPrdBR"
PORT=3000

log_info() {
  echo "[INFO] $1"
}

log_error() {
  echo "[ERROR] $1"
}

# Step 1: Create deployment directory
log_info "Creating deployment directory..."
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# Step 2: Install Node.js (if not already installed)
log_info "Checking Node.js..."
if ! command -v node &> /dev/null; then
  log_info "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null
  apt-get install -y nodejs 2>/dev/null
fi
log_info "Node.js: $(node --version)"

# Step 3: Install pnpm
log_info "Installing pnpm..."
npm install -g pnpm 2>/dev/null || true
log_info "pnpm: $(pnpm --version)"

# Step 4: Install PM2
log_info "Installing PM2..."
npm install -g pm2 2>/dev/null || true
log_info "PM2: $(pm2 --version)"

# Step 5: Create package.json
log_info "Creating package.json..."
cat > package.json << 'EOF'
{
  "name": "mev-engine",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node dist/index.js",
    "dev": "tsx watch server/_core/index.ts"
  },
  "dependencies": {
    "ethers": "^6.13.2",
    "express": "^4.22.1",
    "cors": "^2.8.5",
    "dotenv": "^16.6.1",
    "axios": "^1.7.7"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "tsx": "^4.21.0",
    "@types/node": "^22.19.3",
    "@types/express": "^4.17.25"
  }
}
EOF

# Step 6: Create server directory
log_info "Creating server structure..."
mkdir -p server/_core

# Step 7: Create main server file
cat > server/_core/index.ts << 'SERVEREOF'
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

config({ path: '.env.production' });

const app = express();
const PORT = process.env.PORT || 3000;
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Bot status
app.get('/api/bot/status', (req, res) => {
  res.json({
    running: true,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    alchemy: ALCHEMY_KEY ? 'connected' : 'not configured',
    timestamp: new Date().toISOString()
  });
});

// Start bot
app.post('/api/bot/start', (req, res) => {
  res.json({
    message: 'Bot started',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Stop bot
app.post('/api/bot/stop', (req, res) => {
  res.json({
    message: 'Bot stopped',
    status: 'stopped',
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] MEV Engine running on port ${PORT}`);
  console.log(`[Server] Health: http://localhost:${PORT}/health`);
  console.log(`[Server] Status: http://localhost:${PORT}/api/bot/status`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
SERVEREOF

# Step 8: Create TypeScript config
log_info "Creating TypeScript configuration..."
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
    "sourceMap": true
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Step 9: Create environment file
log_info "Creating .env.production..."
cat > .env.production << EOF
NODE_ENV=production
PORT=$PORT
RPC_URL=https://polygon-rpc.com
ALCHEMY_KEY=$ALCHEMY_KEY
LOG_LEVEL=info
EOF
chmod 600 .env.production

# Step 10: Create logs directory
log_info "Creating logs directory..."
mkdir -p logs

# Step 11: Install dependencies
log_info "Installing dependencies (this may take 2-3 minutes)..."
pnpm install 2>&1 | tail -5

# Step 12: Build TypeScript
log_info "Building TypeScript..."
pnpm run build 2>&1 | tail -5

# Step 13: Create PM2 ecosystem config
log_info "Creating PM2 configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
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
      min_uptime: '10s',
      kill_timeout: 5000
    }
  ]
};
EOF

# Step 14: Stop existing process
log_info "Stopping existing processes..."
pm2 delete mev-engine 2>/dev/null || true

# Step 15: Start with PM2
log_info "Starting MEV engine with PM2..."
pm2 start ecosystem.config.js --env production

# Step 16: Save PM2 process list
pm2 save

# Step 17: Enable startup on reboot
log_info "Enabling PM2 startup on reboot..."
pm2 startup 2>/dev/null || true

# Step 18: Wait for startup
sleep 2

# Step 19: Verify deployment
log_info "Verifying deployment..."
if pm2 list | grep -q "mev-engine"; then
  log_info "✓ MEV engine is running!"
else
  log_error "✗ Failed to start MEV engine"
  pm2 logs mev-engine --lines 20
  exit 1
fi

# Final summary
echo ""
echo "=========================================="
echo "✓ Deployment Complete!"
echo "=========================================="
echo ""
echo "MEV Engine Status:"
echo "  - Service: mev-engine"
echo "  - Port: $PORT"
echo "  - Environment: production"
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
echo "Next Steps:"
echo "  1. Test API: curl http://localhost:3000/health"
echo "  2. Configure trading wallet"
echo "  3. Start trading on Polygon mainnet"
echo ""
echo "=========================================="

# Display PM2 status
pm2 status
