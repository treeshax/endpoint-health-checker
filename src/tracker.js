import { HealthStatus } from './evaluator.js';

export const DEFAULT_MAX_HISTORY = 50;

/**
 * Tracks status transitions, metrics, and bounded history for an endpoint.
 */
export class EndpointTracker {
  /**
   * @param {string} endpointId
   * @param {Object} [options={}]
   * @param {number} [options.maxHistorySize=50] Maximum historical entries to preserve
   */
  constructor(endpointId, options = {}) {
    this.id = endpointId;

    const maxHistory = Number(options.maxHistorySize);
    this.maxHistorySize = Number.isInteger(maxHistory) && maxHistory > 0
      ? maxHistory
      : DEFAULT_MAX_HISTORY;

    this.currentStatus = HealthStatus.UNKNOWN;
    this.previousStatus = HealthStatus.UNKNOWN;

    this.totalChecks = 0;
    this.successfulChecks = 0;
    this.degradedChecks = 0;
    this.failedChecks = 0;
    this.timeoutCount = 0;

    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;

    this.lastSuccessAt = null;
    this.lastFailureAt = null;

    this.totalLatencyMs = 0;
    this.averageLatencyMs = 0;
    this.uptimePercentage = 100;

    this.history = [];
    this.latestResult = null;
  }

  /**
   * Records a new evaluation result and updates all metrics.
   *
   * @param {Object} evalResult Evaluation output from evaluateHealth
   * @returns {{ transitions: string[], metrics: Object }}
   */
  recordCheck(evalResult) {
    this.previousStatus = this.currentStatus;
    this.currentStatus = evalResult.status;
    this.latestResult = evalResult;

    this.totalChecks++;
    const latency = typeof evalResult.latencyMs === 'number' && Number.isFinite(evalResult.latencyMs)
      ? evalResult.latencyMs
      : 0;
    this.totalLatencyMs += latency;
    this.averageLatencyMs = Number((this.totalLatencyMs / this.totalChecks).toFixed(2));

    const timestamp = evalResult.evaluatedAt || new Date().toISOString();

    if (evalResult.status === HealthStatus.UP) {
      this.successfulChecks++;
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;
      this.lastSuccessAt = timestamp;
    } else if (evalResult.status === HealthStatus.DEGRADED) {
      this.degradedChecks++;
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;
      this.lastSuccessAt = timestamp;
    } else {
      this.failedChecks++;
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
      this.lastFailureAt = timestamp;

      if (evalResult.status === HealthStatus.TIMEOUT) {
        this.timeoutCount++;
      }
    }

    // Uptime is based on completed reachable checks: (successfulChecks + degradedChecks) / totalChecks * 100
    const reachableChecks = this.successfulChecks + this.degradedChecks;
    this.uptimePercentage = Number(((reachableChecks / this.totalChecks) * 100).toFixed(2));

    // Bounded history FIFO queue
    this.history.push({
      status: evalResult.status,
      statusCode: evalResult.statusCode ?? null,
      latencyMs: latency,
      error: evalResult.error ?? null,
      timestamp
    });

    if (this.history.length > this.maxHistorySize) {
      this.history.splice(0, this.history.length - this.maxHistorySize);
    }

    // State transition determination
    const transitions = ['check'];

    const wasUnhealthy = this.previousStatus === HealthStatus.DOWN || this.previousStatus === HealthStatus.TIMEOUT;
    const isNowHealthy = this.currentStatus === HealthStatus.UP || this.currentStatus === HealthStatus.DEGRADED;

    if (wasUnhealthy && isNowHealthy) {
      transitions.push('recovered');
    }

    if (this.currentStatus === HealthStatus.UP) {
      if (this.previousStatus !== HealthStatus.UP) {
        transitions.push('up');
      }
    } else if (this.currentStatus === HealthStatus.DEGRADED) {
      if (this.previousStatus !== HealthStatus.DEGRADED) {
        transitions.push('degraded');
      }
    } else if (this.currentStatus === HealthStatus.DOWN) {
      if (this.previousStatus !== HealthStatus.DOWN) {
        transitions.push('down');
      }
    } else if (this.currentStatus === HealthStatus.TIMEOUT) {
      if (this.previousStatus !== HealthStatus.TIMEOUT) {
        transitions.push('timeout');
      }
    }

    return {
      transitions,
      metrics: this.getMetrics()
    };
  }

  /**
   * Returns a copy of the current metrics snapshot.
   * @returns {Object}
   */
  getMetrics() {
    return {
      totalChecks: this.totalChecks,
      successfulChecks: this.successfulChecks,
      degradedChecks: this.degradedChecks,
      failedChecks: this.failedChecks,
      timeoutCount: this.timeoutCount,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      averageLatencyMs: this.averageLatencyMs,
      uptimePercentage: this.uptimePercentage,
      history: [...this.history]
    };
  }
}
