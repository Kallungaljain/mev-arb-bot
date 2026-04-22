/**
 * PM2 Ecosystem Configuration
 * Manages MEV engine process on Oracle Cloud Free Tier
 */

module.exports = {
  apps: [
    {
      name: 'mev-engine',
      script: 'server/_core/index.ts',
      interpreter: 'tsx',
      instances: 1,
      exec_mode: 'fork',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        LOG_LEVEL: 'info',
      },

      // Process management
      watch: false, // Don't watch files in production
      ignore_watch: ['node_modules', 'dist', 'target'],
      max_memory_restart: '512M', // Restart if exceeds 512MB (Oracle Free Tier constraint)
      
      // Error handling
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Auto restart
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 3000,

      // Monitoring
      monitor_interval: 5000,
    },
  ],

  // Cluster mode for multiple instances (if needed)
  // instances: 'max',
  // exec_mode: 'cluster',

  // Deploy configuration for Oracle Cloud
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'YOUR_ORACLE_INSTANCE_IP',
      key: '~/.ssh/id_rsa',
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_REPO/mev-arb-bot.git',
      path: '/home/ubuntu/mev-arb-bot',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
    },
  },
};
