/**
 * Error Recovery & Circuit Breaker
 * Handles failures gracefully with exponential backoff and circuit breaking
 * 
 * Features:
 * - Exponential backoff retry
 * - Circuit breaker pattern
 * - Error categorization
 * - Automatic recovery
 */

enum ErrorCategory {
  NETWORK = 'NETWORK',
  RPC = 'RPC',
  TRANSACTION = 'TRANSACTION',
  VALIDATION = 'VALIDATION',
  UNKNOWN = 'UNKNOWN',
}

enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing recovery
}

interface ErrorMetrics {
  totalErrors: number;
  errorsByCategory: Map<ErrorCategory, number>;
  lastError?: { message: string; timestamp: number };
  errorRate: number; // errors per minute
}

interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening
  successThreshold: number; // Successes to close from half-open
  timeout: number; // ms before half-open attempt
  windowSize: number; // ms for error rate calculation
}

/**
 * Error categorizer
 */
export class ErrorCategorizer {
  /**
   * Categorize error
   */
  static categorize(error: any): ErrorCategory {
    const message = error?.message?.toLowerCase() || '';

    if (message.includes('network') || message.includes('econnrefused')) {
      return ErrorCategory.NETWORK;
    }

    if (message.includes('rpc') || message.includes('json-rpc')) {
      return ErrorCategory.RPC;
    }

    if (
      message.includes('transaction') ||
      message.includes('revert') ||
      message.includes('gas')
    ) {
      return ErrorCategory.TRANSACTION;
    }

    if (message.includes('validation') || message.includes('invalid')) {
      return ErrorCategory.VALIDATION;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * Is error retryable
   */
  static isRetryable(error: any): boolean {
    const category = this.categorize(error);
    return [ErrorCategory.NETWORK, ErrorCategory.RPC].includes(category);
  }

  /**
   * Get retry delay
   */
  static getRetryDelay(attempt: number, baseDelay = 1000): number {
    // Exponential backoff with jitter
    const exponential = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponential;
    return exponential + jitter;
  }
}

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;
  private metrics: ErrorMetrics;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 60000, // 1 minute
      windowSize: config.windowSize || 60000,
    };

    this.metrics = {
      totalErrors: 0,
      errorsByCategory: new Map(),
      errorRate: 0,
    };
  }

  /**
   * Record success
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.config.successThreshold) {
        this.close();
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  /**
   * Record failure
   */
  recordFailure(error: any): void {
    const category = ErrorCategorizer.categorize(error);

    this.metrics.totalErrors++;
    this.metrics.errorsByCategory.set(
      category,
      (this.metrics.errorsByCategory.get(category) || 0) + 1
    );
    this.metrics.lastError = {
      message: error?.message || 'Unknown error',
      timestamp: Date.now(),
    };

    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.CLOSED) {
      this.failureCount++;

      if (this.failureCount >= this.config.failureThreshold) {
        this.open();
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.open();
    }

    this.updateErrorRate();
  }

  /**
   * Check if request should be allowed
   */
  canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if timeout has passed
      if (Date.now() - this.lastFailureTime > this.config.timeout) {
        this.halfOpen();
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow one request
    return true;
  }

  /**
   * Open circuit
   */
  private open(): void {
    if (this.state !== CircuitState.OPEN) {
      console.warn('[CircuitBreaker] Circuit opened due to failures');
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    }
  }

  /**
   * Half-open circuit
   */
  private halfOpen(): void {
    console.warn('[CircuitBreaker] Circuit half-open, testing recovery');
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;
  }

  /**
   * Close circuit
   */
  private close(): void {
    if (this.state !== CircuitState.CLOSED) {
      console.log('[CircuitBreaker] Circuit closed, normal operation resumed');
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
      this.successCount = 0;
    }
  }

  /**
   * Update error rate
   */
  private updateErrorRate(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowSize;

    // In production, would track errors in time window
    this.metrics.errorRate = this.metrics.totalErrors / (this.config.windowSize / 60000);
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
  getMetrics(): ErrorMetrics {
    return {
      ...this.metrics,
      errorsByCategory: new Map(this.metrics.errorsByCategory),
    };
  }

  /**
   * Reset circuit
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.metrics = {
      totalErrors: 0,
      errorsByCategory: new Map(),
      errorRate: 0,
    };
    console.log('[CircuitBreaker] Circuit reset');
  }
}

/**
 * Retry executor with exponential backoff
 */
export class RetryExecutor {
  private maxRetries: number;
  private baseDelay: number;

  constructor(maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
  }

  /**
   * Execute with retry
   */
  async execute<T>(
    fn: () => Promise<T>,
    onRetry?: (attempt: number, error: any) => void
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (!ErrorCategorizer.isRetryable(error) || attempt === this.maxRetries) {
          throw error;
        }

        const delay = ErrorCategorizer.getRetryDelay(attempt, this.baseDelay);

        console.warn(
          `[RetryExecutor] Attempt ${attempt + 1} failed, retrying in ${delay.toFixed(0)}ms`
        );

        if (onRetry) {
          onRetry(attempt + 1, error);
        }

        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError;
  }

  /**
   * Execute with circuit breaker
   */
  async executeWithCircuitBreaker<T>(
    fn: () => Promise<T>,
    circuitBreaker: CircuitBreaker
  ): Promise<T> {
    if (!circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await this.execute(fn);
      circuitBreaker.recordSuccess();
      return result;
    } catch (error: any) {
      circuitBreaker.recordFailure(error);
      throw error;
    }
  }
}

/**
 * Health check system
 */
export class HealthCheck {
  private checks = new Map<string, () => Promise<boolean>>();
  private lastResults = new Map<string, { healthy: boolean; timestamp: number }>();

  /**
   * Register health check
   */
  registerCheck(name: string, check: () => Promise<boolean>): void {
    this.checks.set(name, check);
  }

  /**
   * Run all checks
   */
  async runAll(): Promise<{ name: string; healthy: boolean; timestamp: number }[]> {
    const results = [];

    for (const [name, check] of this.checks) {
      try {
        const healthy = await check();
        const result = { healthy, timestamp: Date.now() };
        this.lastResults.set(name, result);
        results.push({ name, ...result });
      } catch (error: any) {
        console.error(`[HealthCheck] Check failed: ${name}`, error.message);
        const result = { healthy: false, timestamp: Date.now() };
        this.lastResults.set(name, result);
        results.push({ name, ...result });
      }
    }

    return results;
  }

  /**
   * Get overall health
   */
  getOverallHealth(): boolean {
    for (const result of this.lastResults.values()) {
      if (!result.healthy) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get results
   */
  getResults(): Map<string, { healthy: boolean; timestamp: number }> {
    return new Map(this.lastResults);
  }
}
