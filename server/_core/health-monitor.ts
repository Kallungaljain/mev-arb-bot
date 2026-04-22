/**
 * Health Monitoring and Logging
 * Tracks engine health, performance, and errors
 */

import * as fs from 'fs';
import * as path from 'path';

interface HealthMetrics {
  uptime: number;
  memory: {
    used: number;
    total: number;
    percent: number;
  };
  cpu: {
    usage: number;
  };
  engine: {
    running: boolean;
    scans: number;
    trades: number;
    profit: number;
    errors: number;
    avgLatency: number;
  };
  websocket: {
    connected: boolean;
    pools: number;
  };
  timestamp: number;
}

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  data?: any;
}

/**
 * Health monitor
 */
export class HealthMonitor {
  private logDir: string;
  private logFile: string;
  private metricsFile: string;
  private startTime: number;
  private logs: LogEntry[] = [];
  private maxLogs = 10000;

  constructor(logDir: string = './logs') {
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'engine.log');
    this.metricsFile = path.join(logDir, 'metrics.json');
    this.startTime = Date.now();

    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Log message
   */
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      data,
    };

    this.logs.push(entry);

    // Keep only recent logs in memory
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Write to file
    this.writeLogToFile(entry);

    // Console output
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
    const output = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  /**
   * Get health metrics
   */
  getMetrics(engineStats: any, websocketStatus: any): HealthMetrics {
    const memUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    return {
      uptime,
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
      cpu: {
        usage: process.cpuUsage().user / 1000000, // Convert to seconds
      },
      engine: {
        running: engineStats?.running || false,
        scans: engineStats?.stats?.totalScans || 0,
        trades: engineStats?.stats?.tradesExecuted || 0,
        profit: engineStats?.stats?.totalProfit || 0,
        errors: engineStats?.stats?.errors || 0,
        avgLatency: engineStats?.stats?.avgLatency || 0,
      },
      websocket: {
        connected: websocketStatus?.connected || false,
        pools: websocketStatus?.listeners || 0,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Save metrics to file
   */
  saveMetrics(metrics: HealthMetrics): void {
    try {
      fs.writeFileSync(this.metricsFile, JSON.stringify(metrics, null, 2));
    } catch (error) {
      console.error('Error saving metrics:', error);
    }
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: string, count: number = 100): LogEntry[] {
    return this.logs.filter((log) => log.level === level).slice(-count);
  }

  /**
   * Export logs
   */
  exportLogs(filename: string): void {
    try {
      const filepath = path.join(this.logDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(this.logs, null, 2));
      console.log(`Logs exported to ${filepath}`);
    } catch (error) {
      console.error('Error exporting logs:', error);
    }
  }

  /**
   * Clear old logs (keep last N days)
   */
  clearOldLogs(daysToKeep: number = 7): void {
    try {
      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      this.logs = this.logs.filter((log) => log.timestamp > cutoffTime);
      console.log(`Cleared logs older than ${daysToKeep} days`);
    } catch (error) {
      console.error('Error clearing old logs:', error);
    }
  }

  /**
   * Write log to file
   */
  private writeLogToFile(entry: LogEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logFile, line);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  /**
   * Get health status
   */
  getHealthStatus(metrics: HealthMetrics): {
    status: 'healthy' | 'degraded' | 'critical';
    issues: string[];
  } {
    const issues: string[] = [];

    // Check memory
    if (metrics.memory.percent > 80) {
      issues.push('High memory usage');
    }

    // Check engine
    if (!metrics.engine.running) {
      issues.push('Engine not running');
    }

    if (metrics.engine.errors > 100) {
      issues.push('High error count');
    }

    // Check websocket
    if (!metrics.websocket.connected) {
      issues.push('WebSocket disconnected');
    }

    // Determine status
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (issues.length > 0) {
      status = issues.some((i) => i.includes('Engine') || i.includes('WebSocket')) ? 'critical' : 'degraded';
    }

    return { status, issues };
  }
}

/**
 * Singleton instance
 */
let monitorInstance: HealthMonitor | null = null;

export function getHealthMonitor(logDir?: string): HealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new HealthMonitor(logDir);
  }
  return monitorInstance;
}

export function createHealthMonitor(logDir?: string): HealthMonitor {
  return new HealthMonitor(logDir);
}
