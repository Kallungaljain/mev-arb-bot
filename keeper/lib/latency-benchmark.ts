/**
 * Latency Benchmark & Validation
 * 
 * Measures end-to-end latency for all components.
 */

interface LatencyMeasurement {
  component: string;
  latencyMs: number;
  timestamp: number;
}

export class LatencyBenchmark {
  private measurements: LatencyMeasurement[] = [];
  private startTimes = new Map<string, number>();

  /**
   * Start measuring a component
   */
  start(component: string) {
    this.startTimes.set(component, Date.now());
  }

  /**
   * End measurement
   */
  end(component: string) {
    const startTime = this.startTimes.get(component);
    if (!startTime) {
      console.warn(`[Benchmark] No start time for ${component}`);
      return;
    }

    const latencyMs = Date.now() - startTime;

    this.measurements.push({
      component,
      latencyMs,
      timestamp: Date.now(),
    });

    this.startTimes.delete(component);

    console.log(`[Benchmark] ${component}: ${latencyMs}ms`);
  }

  /**
   * Get statistics for a component
   */
  getStats(component: string) {
    const measurements = this.measurements.filter(m => m.component === component);

    if (measurements.length === 0) {
      return null;
    }

    const latencies = measurements.map(m => m.latencyMs);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
    const p99 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

    return { min, max, avg, p95, p99, count: latencies.length };
  }

  /**
   * Get all statistics
   */
  getAllStats() {
    const components = new Set(this.measurements.map(m => m.component));
    const stats: Record<string, any> = {};

    for (const component of components) {
      stats[component] = this.getStats(component);
    }

    return stats;
  }

  /**
   * Get end-to-end latency
   */
  getEndToEndLatency(): number | null {
    const measurements = this.measurements.filter(m =>
      ['detection', 'validation', 'execution'].includes(m.component)
    );

    if (measurements.length === 0) return null;

    const total = measurements.reduce((sum, m) => sum + m.latencyMs, 0);
    return total;
  }

  /**
   * Validate latency targets
   */
  validate(): {
    valid: boolean;
    targets: Record<string, { target: number; actual: number; status: string }>;
  } {
    const targets = {
      'websocket-event': 150,
      'pool-update': 20,
      'bellman-ford': 15,
      'profit-simulation': 50,
      'mev-risk': 20,
      'calldata-encoding': 10,
      'flashbots-submission': 200,
      'end-to-end': 200,
    };

    const results: Record<string, { target: number; actual: number; status: string }> = {};

    for (const [component, target] of Object.entries(targets)) {
      const stats = this.getStats(component);
      const actual = stats?.avg || 0;
      const status = actual <= target ? '✓ PASS' : '✗ FAIL';

      results[component] = { target, actual, status };
    }

    const valid = Object.values(results).every(r => r.status === '✓ PASS');

    return { valid, targets: results };
  }

  /**
   * Clear measurements
   */
  clear() {
    this.measurements = [];
    this.startTimes.clear();
  }

  /**
   * Export measurements
   */
  export() {
    return {
      measurements: this.measurements,
      stats: this.getAllStats(),
      validation: this.validate(),
    };
  }
}

/**
 * Global benchmark instance
 */
export const globalBenchmark = new LatencyBenchmark();

/**
 * Helper function to measure async operations
 */
export async function measureLatency<T>(
  component: string,
  fn: () => Promise<T>
): Promise<T> {
  globalBenchmark.start(component);
  try {
    const result = await fn();
    globalBenchmark.end(component);
    return result;
  } catch (error) {
    globalBenchmark.end(component);
    throw error;
  }
}

/**
 * Helper function to measure sync operations
 */
export function measureLatencySync<T>(
  component: string,
  fn: () => T
): T {
  globalBenchmark.start(component);
  try {
    const result = fn();
    globalBenchmark.end(component);
    return result;
  } catch (error) {
    globalBenchmark.end(component);
    throw error;
  }
}
