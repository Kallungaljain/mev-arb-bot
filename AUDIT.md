# System Audit: Current vs Production Requirements

## Summary

The current system has **50% of required components** but uses a different architecture (Node.js + WebSocket) than specified (Rust + ZeroMQ). A significant rebuild is needed to meet production-grade requirements.

---

## Architecture Comparison

| Layer | Current | Required | Status |
|-------|---------|----------|--------|
| **Scanner** | Node.js (server/scanner.ts) | Rust binary (ZeroMQ PUSH) | ❌ Wrong tech stack |
| **Keeper** | Node.js (keeper/) | Rust binary (ZeroMQ PULL) | ❌ Wrong tech stack |
| **Queen** | React Native (app/) | Mobile HTTP server | ⚠️ Partial (no HTTP server) |
| **IPC** | WebSocket | ZeroMQ | ❌ Missing |
| **Risk Engine** | Hardcoded in bot-context.ts | Configurable (risk.toml) | ⚠️ Partial |
| **Systemd** | Docker Compose | systemd services | ❌ Missing |
| **Config** | AsyncStorage | TOML files | ❌ Missing |

---

## Component Audit

### ✅ Implemented (Partial)

1. **Android App (Queen)**
   - ✅ 5 screens (Dashboard, Scan, History, Deploy, Settings)
   - ✅ Dark trading theme
   - ✅ Alchemy API integration
   - ✅ Local settings persistence (AsyncStorage)
   - ❌ HTTP server (needed for Keeper to send flagged events)
   - ❌ Emergency PAUSE/RESUME API
   - ❌ Configuration UI for risk parameters

2. **Risk Engine**
   - ✅ Slippage calculation
   - ✅ Volatility filtering
   - ✅ Gas cost vs profit check
   - ✅ Minimum profit threshold
   - ❌ Configurable via TOML (currently hardcoded)
   - ❌ Fast-path / slow-path routing (95/5 split)
   - ❌ Detailed logging of decision path

3. **Solidity Contract**
   - ✅ EliteAntArb.sol (oracle-free flash loan)
   - ✅ Hardhat tests
   - ✅ Deploy script
   - ✅ AAVE V3 integration

### ❌ Missing (Critical)

1. **Rust Scanner**
   - ❌ Rust binary (currently Node.js)
   - ❌ ZeroMQ PUSH endpoint (tcp://127.0.0.1:5555)
   - ❌ Async Rust with zero-copy performance
   - ❌ HTTP status endpoint (port 8080)

2. **Rust Keeper**
   - ❌ Rust binary (currently Node.js)
   - ❌ ZeroMQ PULL endpoint
   - ❌ Risk engine with configurable thresholds
   - ❌ Fast-path / slow-path routing
   - ❌ HTTP client to Queen (POST flagged events)
   - ❌ Detailed decision logging

3. **Queen HTTP Server**
   - ❌ HTTP server running on mobile (port 5000)
   - ❌ `/api/approve` endpoint (receive flagged events, return decision)
   - ❌ `/api/pause` endpoint (emergency stop)
   - ❌ `/api/config` endpoint (update risk parameters)

4. **Systemd Services**
   - ❌ elite-scanner.service
   - ❌ elite-keeper.service
   - ❌ Auto-restart, logging to journald
   - ❌ Service status monitoring

5. **Configuration System**
   - ❌ engine.toml (scanner config)
   - ❌ risk.toml (keeper risk thresholds)
   - ❌ network.toml (ZeroMQ, HTTP endpoints)
   - ❌ Config hot-reload capability

6. **Deployment Infrastructure**
   - ❌ VPS setup scripts (Ubuntu 24.04, Rust toolchain)
   - ❌ Build scripts for Rust binaries
   - ❌ Systemd service installation
   - ❌ Health-check monitoring
   - ❌ Log aggregation

---

## Gap Analysis

### Critical Path Issues

| Issue | Impact | Priority |
|-------|--------|----------|
| No Rust Scanner | Cannot achieve <1ms latency target | 🔴 CRITICAL |
| No ZeroMQ IPC | Cannot achieve ultra-low-latency communication | 🔴 CRITICAL |
| No Rust Keeper | Cannot achieve production-grade reliability | 🔴 CRITICAL |
| No Queen HTTP Server | Cannot receive flagged events from Keeper | 🔴 CRITICAL |
| No Systemd Services | Cannot auto-restart or monitor services | 🟠 HIGH |
| No TOML Config | Cannot configure risk parameters on VPS | 🟠 HIGH |
| No Fast/Slow Path | Cannot route 95% of events to fast execution | 🟠 HIGH |

---

## Rebuild Plan

### Phase 1: Rust Scanner (NEW)
- Create `/scanner-rust/` directory
- Implement WebSocket listener (Tokio + tungstenite)
- Implement ZeroMQ PUSH (zmq crate)
- Add HTTP status endpoint (Axum)
- Metrics: scan count, opportunities, latency

### Phase 2: Rust Keeper (NEW)
- Create `/keeper-rust/` directory
- Implement ZeroMQ PULL listener
- Implement risk engine with configurable thresholds
- Implement fast-path / slow-path routing (95/5)
- Implement HTTP client to Queen (reqwest)
- Add detailed logging (tracing)

### Phase 3: Queen HTTP Server (UPGRADE)
- Add HTTP server to mobile app (using Actix or Axum via FFI)
- Implement `/api/approve` endpoint
- Implement `/api/pause` endpoint
- Implement `/api/config` endpoint
- Add configuration UI to Settings screen

### Phase 4: Configuration System (NEW)
- Create `config/engine.toml`
- Create `config/risk.toml`
- Create `config/network.toml`
- Implement config loader in both Rust binaries
- Implement hot-reload capability

### Phase 5: Systemd Services (NEW)
- Create `elite-scanner.service`
- Create `elite-keeper.service`
- Create VPS setup scripts
- Create health-check monitoring

### Phase 6: Testing & Deployment (NEW)
- End-to-end testing
- VPS deployment guide
- Monitoring and alerting setup

---

## Estimated Effort

| Component | Effort | Status |
|-----------|--------|--------|
| Rust Scanner | 8 hours | TODO |
| Rust Keeper | 10 hours | TODO |
| Queen HTTP Server | 4 hours | TODO |
| Configuration System | 3 hours | TODO |
| Systemd Services | 2 hours | TODO |
| Testing & Deployment | 5 hours | TODO |
| **Total** | **32 hours** | **0% Complete** |

---

## Recommendation

**Proceed with full rebuild** to meet production-grade requirements. The current Node.js architecture is suitable for prototyping but cannot achieve:

- Ultra-low latency (<1ms) required for competitive MEV arbitrage
- Crash-safe systemd service management
- Zero-copy message passing (ZeroMQ)
- Configurable risk engine without code changes
- Proper separation of concerns (Scanner → Keeper → Queen)

The Rust + ZeroMQ architecture is the industry standard for high-frequency trading systems and will provide the reliability and performance needed for production deployment.

---

## Next Steps

1. ✅ Audit complete (this document)
2. → Build Rust Scanner with ZeroMQ PUSH
3. → Build Rust Keeper with ZeroMQ PULL + risk engine
4. → Upgrade Queen app with HTTP server
5. → Create systemd services and deployment scripts
6. → End-to-end testing and VPS deployment
