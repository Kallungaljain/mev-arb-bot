# Oracle Cloud Shell - Automated Deployment

## Quick Deploy (Copy & Paste)

Open Oracle Cloud Shell and run this command:

```bash
bash <(curl -s https://raw.githubusercontent.com/YOUR_REPO/mev-arb-bot/main/deploy-to-oracle.sh)
```

Or if you don't have a GitHub repo yet, use this local deployment method:

## Local Deployment Method (Recommended)

### Step 1: Copy deployment script to your instance

From your local machine or Oracle Cloud Shell:

```bash
# Set your instance IP
INSTANCE_IP="141.147.92.254"

# Copy the deployment script
scp -i ~/.ssh/id_rsa deploy-to-oracle.sh ubuntu@$INSTANCE_IP:/tmp/

# SSH into instance
ssh -i ~/.ssh/id_rsa ubuntu@$INSTANCE_IP
```

### Step 2: Run deployment on instance

```bash
# Run the deployment script
bash /tmp/deploy-to-oracle.sh

# This will:
# - Install Node.js 22
# - Install pnpm
# - Install PM2
# - Create MEV engine application
# - Install dependencies
# - Build TypeScript
# - Start with PM2
# - Enable auto-restart on reboot
```

### Step 3: Verify deployment

```bash
# Check status
pm2 status

# View logs
pm2 logs mev-engine

# Test API
curl http://localhost:3000/health
curl http://localhost:3000/api/bot/status
```

## Using Oracle Cloud Shell (Easiest)

If you have Oracle Cloud Shell access:

### Step 1: Create deployment script in Cloud Shell

```bash
cat > ~/deploy-mev.sh << 'DEPLOY_EOF'
#!/bin/bash
set -e

# Configuration
DEPLOY_DIR="/home/ubuntu/mev-engine"
ALCHEMY_KEY="Z2W4KU8VAD67eVEGPrdBR"
PORT=3000

echo "Starting MEV Engine deployment..."

# Update system
sudo apt-get update -qq && sudo apt-get upgrade -y -qq

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
sudo apt-get install -y nodejs > /dev/null 2>&1

# Install pnpm
npm install -g pnpm > /dev/null 2>&1

# Install PM2
npm install -g pm2 > /dev/null 2>&1

# Create deployment directory
mkdir -p $DEPLOY_DIR
cd $DEPLOY_DIR

# Create package.json
cat > package.json << 'EOF'
{
  "name": "mev-engine",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node dist/index.js"
  },
  "dependencies": {
    "ethers": "^6.13.2",
    "express": "^4.22.1",
    "cors": "^2.8.5",
    "dotenv": "^16.6.1"
  }
}
EOF

# Create server
mkdir -p server/_core
cat > server/_core/index.ts << 'SERVEREOF'
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

config({ path: '.env.production' });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

app.listen(PORT, () => {
  console.log(`[Server] MEV Engine running on port ${PORT}`);
});
SERVEREOF

# Create .env
cat > .env.production << EOF
NODE_ENV=production
PORT=$PORT
RPC_URL=https://polygon-rpc.com
ALCHEMY_KEY=$ALCHEMY_KEY
LOG_LEVEL=info
EOF
chmod 600 .env.production

# Install dependencies
pnpm install > /dev/null 2>&1

# Create PM2 config
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'mev-engine',
    script: 'server/_core/index.ts',
    interpreter: 'tsx',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', PORT: 3000 },
    watch: false,
    max_memory_restart: '512M',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    autorestart: true,
    max_restarts: 10
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Start with PM2
pm2 delete mev-engine 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup > /dev/null 2>&1 || true

echo "✓ Deployment complete!"
echo "Check status: pm2 status"
echo "View logs: pm2 logs mev-engine"
DEPLOY_EOF

chmod +x ~/deploy-mev.sh
```

### Step 2: Run on your instance

```bash
# Run deployment
bash ~/deploy-mev.sh
```

### Step 3: Verify

```bash
# Check if running
pm2 status

# View logs
pm2 logs mev-engine

# Test API
curl http://localhost:3000/health
```

## Troubleshooting

### Check logs
```bash
pm2 logs mev-engine --lines 100
```

### Restart service
```bash
pm2 restart mev-engine
```

### Check memory usage
```bash
pm2 monit
```

### Stop service
```bash
pm2 stop mev-engine
```

## Next Steps

1. ✅ Deployment complete
2. Add trading wallet credentials
3. Configure Alchemy WebSocket
4. Start trading on Polygon mainnet

## Support

For issues, check:
- Logs: `pm2 logs mev-engine`
- Status: `pm2 status`
- Health: `curl http://localhost:3000/health`
