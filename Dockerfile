# Multi-stage build for MEV engine
# Optimized for Oracle Cloud Free Tier (ARM-based Ampere A1)

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run check

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/app.config.ts ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose ports
EXPOSE 3000 8081

# Start with PM2
CMD ["pm2-runtime", "start", "server/_core/index.ts", "--name", "mev-engine", "--interpreter", "tsx"]
