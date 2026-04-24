/**
 * Production Hardening
 * - Circuit breaker pattern
 * - Error recovery
 * - Health monitoring
 * - Graceful degradation
 */

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  failureThreshold: number; // failures before opening
  successThreshold: number; // successes before closing
  timeout: number; // ms before half-open
}

interface HealthMetrics {
  uptime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  lastError?: string;
  lastErrorTime?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;
  private startTime = Date.now();

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Record success
   */
  recordSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.successCount = 0;
        console.log('[CircuitBreaker] Circuit closed - system recovered');
      }
    }
  }

  /**
   * Record failure
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold && this.state === 'closed') {
      this.state = 'open';
      console.error('[CircuitBreaker] Circuit opened - too many failures');
    }
  }

  /**
   * Check if request should be allowed
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.config.timeout) {
        this.state = 'half-open';
        this.successCount = 0;
        console.log('[CircuitBreaker] Circuit half-open - attempting recovery');
        return true;
      }
      return false;
    }

    // half-open state
    return true;
  }

  /**
   * Get state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get metrics
   */
  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    timeSinceLastFailure: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      timeSinceLastFailure: Date.now() - this.lastFailureTime,
    };
  }
}

export class HealthMonitor {
  private startTime = Date.now();
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private lastError: string | undefined;
  private lastErrorTime: number | undefined;

  /**
   * Record request
   */
  recordRequest(success: boolean, error?: string): void {
    this.totalRequests++;

    if (success) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
      this.lastError = error;
      this.lastErrorTime = Date.now();
    }
  }

  /**
   * Get health metrics
   */
  getMetrics(): HealthMetrics {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.totalRequests > 0 ? (this.failedRequests / this.totalRequests) * 100 : 0;

    return {
      uptime,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      errorRate,
      lastError: this.lastError,
      lastErrorTime: this.lastErrorTime,
    };
  }

  /**
   * Is healthy
   */
  isHealthy(): boolean {
    const metrics = this.getMetrics();
    return metrics.errorRate < 5; // Less than 5% error rate
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.lastError = undefined;
    this.lastErrorTime = undefined;
  }
}

export class RetryStrategy {
  /**
   * Exponential backoff retry
   */
  static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.error(`[RetryStrategy] Attempt ${attempt + 1} failed:`, error);

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`[RetryStrategy] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Linear backoff retry
   */
  static async retryLinear<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}

export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if request is allowed
   */
  isAllowed(): boolean {
    const now = Date.now();

    // Remove old requests outside window
    this.requests = this.requests.filter((time) => now - time < this.windowMs);

    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }

    return false;
  }

  /**
   * Get current rate
   */
  getCurrentRate(): number {
    const now = Date.now();
    this.requests = this.requests.filter((time) => now - time < this.windowMs);
    return this.requests.length;
  }

  /**
   * Reset
   */
  reset(): void {
    this.requests = [];
  }
}

export default {
  CircuitBreaker,
  HealthMonitor,
  RetryStrategy,
  RateLimiter,
};
