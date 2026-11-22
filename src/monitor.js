import { EventEmitter } from 'node:events';
import { probeEndpoint } from './prober.js';
import { evaluateHealth, HealthStatus } from './evaluator.js';
import { Scheduler } from './scheduler.js';
import { EndpointTracker, DEFAULT_MAX_HISTORY } from './tracker.js';

/**
 * Validates endpoint configuration for registration, applying auth and callback checks.
 * @param {Object} config
 * @returns {Object} Validated and normalized configuration
 */
function validateEndpointConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('Endpoint configuration must be an object');
  }

  const {
    url,
    id,
    name,
    method = 'GET',
    headers = {},
    body,
    timeoutMs,
    defaultTimeoutMs,
    intervalMs,
    expectedStatus,
    maxLatencyMs,
    maxAcceptableLatencyMs,
    maxHistorySize,
    auth,
    onUp,
    onDown,
    onDegraded,
    onRecovered
  } = config;

  if (!url || typeof url !== 'string') {
    throw new TypeError('Endpoint "url" is required and must be a string');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    throw new TypeError(`Endpoint "url" is invalid: ${err.message}`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new TypeError(`Endpoint protocol "${parsedUrl.protocol}" is not supported. Use "http:" or "https:"`);
  }

  const endpointId = id !== undefined && id !== null ? String(id).trim() : url;
  if (!endpointId) {
    throw new TypeError('Endpoint "id" cannot be an empty string');
  }

  const normalizedMethod = String(method).toUpperCase();
  const validMethods = ['GET', 'HEAD', 'POST'];
  if (!validMethods.includes(normalizedMethod)) {
    throw new TypeError(`Endpoint method "${method}" is not supported. Supported methods: ${validMethods.join(', ')}`);
  }

  if (headers !== null && typeof headers !== 'object') {
    throw new TypeError('Endpoint "headers" must be a key-value object');
  }

  const normalizedHeaders = { ...headers };

  // Convenience Authentication Configuration
  if (auth !== undefined && auth !== null) {
    if (typeof auth !== 'object') {
      throw new TypeError('Endpoint "auth" must be an object');
    }

    if (auth.bearer) {
      if (typeof auth.bearer !== 'string') {
        throw new TypeError('Endpoint auth "bearer" token must be a string');
      }
      normalizedHeaders['Authorization'] = `Bearer ${auth.bearer}`;
    } else if (auth.basic) {
      if (!auth.basic.username || typeof auth.basic.username !== 'string') {
        throw new TypeError('Endpoint auth "basic.username" must be a non-empty string');
      }
      const password = auth.basic.password !== undefined ? String(auth.basic.password) : '';
      const encoded = Buffer.from(`${auth.basic.username}:${password}`).toString('base64');
      normalizedHeaders['Authorization'] = `Basic ${encoded}`;
    } else if (auth.apiKey) {
      const headerName = typeof auth.apiKey.header === 'string' && auth.apiKey.header ? auth.apiKey.header : 'X-API-Key';
      if (typeof auth.apiKey.value !== 'string') {
        throw new TypeError('Endpoint auth "apiKey.value" must be a string');
      }
      normalizedHeaders[headerName] = auth.apiKey.value;
    }
  }

  const rawEndpointTimeout = timeoutMs ?? defaultTimeoutMs;
  let parsedTimeoutMs;
  if (rawEndpointTimeout !== undefined && rawEndpointTimeout !== null) {
    parsedTimeoutMs = Number(rawEndpointTimeout);
    if (!Number.isFinite(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
      throw new RangeError('Endpoint "timeoutMs" must be a positive number');
    }
  }

  let parsedIntervalMs;
  if (intervalMs !== undefined && intervalMs !== null) {
    parsedIntervalMs = Number(intervalMs);
    if (!Number.isFinite(parsedIntervalMs) || parsedIntervalMs <= 0) {
      throw new RangeError('Endpoint "intervalMs" must be a positive number');
    }
  }

  const rawLatencyThreshold = maxLatencyMs ?? maxAcceptableLatencyMs;
  let parsedMaxLatency;
  if (rawLatencyThreshold !== undefined && rawLatencyThreshold !== null) {
    parsedMaxLatency = Number(rawLatencyThreshold);
    if (!Number.isFinite(parsedMaxLatency) || parsedMaxLatency <= 0) {
      throw new RangeError('Endpoint "maxLatencyMs" must be a positive number');
    }
  }

  let parsedHistory;
  if (maxHistorySize !== undefined && maxHistorySize !== null) {
    parsedHistory = Number(maxHistorySize);
    if (!Number.isInteger(parsedHistory) || parsedHistory <= 0) {
      throw new RangeError('Endpoint "maxHistorySize" must be a positive integer');
    }
  }

  // Validate callback hooks if provided
  if (onUp !== undefined && typeof onUp !== 'function') {
    throw new TypeError('Endpoint "onUp" callback must be a function');
  }
  if (onDown !== undefined && typeof onDown !== 'function') {
    throw new TypeError('Endpoint "onDown" callback must be a function');
  }
  if (onDegraded !== undefined && typeof onDegraded !== 'function') {
    throw new TypeError('Endpoint "onDegraded" callback must be a function');
  }
  if (onRecovered !== undefined && typeof onRecovered !== 'function') {
    throw new TypeError('Endpoint "onRecovered" callback must be a function');
  }

  return {
    id: endpointId,
    name: typeof name === 'string' && name.trim() ? name.trim() : endpointId,
    url: parsedUrl.toString(),
    method: normalizedMethod,
    headers: normalizedHeaders,
    body,
    timeoutMs: parsedTimeoutMs,
    intervalMs: parsedIntervalMs,
    expectedStatus,
    maxLatencyMs: parsedMaxLatency,
    maxHistorySize: parsedHistory,
    onUp,
    onDown,
    onDegraded,
    onRecovered
  };
}

/**
 * Central Monitoring Manager coordinating Prober, Evaluator, Scheduler, and Metrics.
 */
export class EndpointMonitor extends EventEmitter {
  /**
   * @param {Object} [globalConfig={}] Global defaults
   * @param {number} [globalConfig.defaultIntervalMs=30000] Default check interval in ms
   * @param {number} [globalConfig.defaultTimeoutMs=5000] Default request timeout in ms
   * @param {number} [globalConfig.timeoutMs=5000] Backwards-compatible alias for defaultTimeoutMs
   * @param {number} [globalConfig.maxHistorySize=50] Default maximum history size
   * @param {number} [globalConfig.maxLatencyMs] Global maximum latency threshold
   */
  constructor(globalConfig = {}) {
    super();

    const defaultInterval = Number(globalConfig.defaultIntervalMs);
    this.defaultIntervalMs = Number.isFinite(defaultInterval) && defaultInterval > 0
      ? defaultInterval
      : 30000;

    const rawTimeout = globalConfig.defaultTimeoutMs ?? globalConfig.timeoutMs;
    const defaultTimeout = Number(rawTimeout);
    this.defaultTimeoutMs = Number.isFinite(defaultTimeout) && defaultTimeout > 0
      ? defaultTimeout
      : 5000;
    this.timeoutMs = this.defaultTimeoutMs;

    const maxHistory = Number(globalConfig.maxHistorySize);
    this.maxHistorySize = Number.isInteger(maxHistory) && maxHistory > 0
      ? maxHistory
      : DEFAULT_MAX_HISTORY;

    const globalLatency = Number(globalConfig.maxLatencyMs ?? globalConfig.maxAcceptableLatencyMs);
    this.defaultMaxLatencyMs = Number.isFinite(globalLatency) && globalLatency > 0
      ? globalLatency
      : undefined;

    this.endpoints = new Map();
    this.trackers = new Map();
    this.results = new Map();

    this.scheduler = new Scheduler({
      onError: (err, id) => {
        this._safeEmit('error', err, id);
      }
    });
  }

  /**
   * Registers an endpoint to be monitored.
   *
   * @param {Object} config Endpoint configuration
   * @returns {EndpointMonitor} Returns instance for method chaining
   */
  addEndpoint(config) {
    const validated = validateEndpointConfig(config);
    const { id } = validated;

    if (this.endpoints.has(id)) {
      throw new Error(`Endpoint with id "${id}" is already registered`);
    }

    const intervalMs = validated.intervalMs || this.defaultIntervalMs;
    const timeoutMs = validated.timeoutMs || this.defaultTimeoutMs;
    const maxLatencyMs = validated.maxLatencyMs || this.defaultMaxLatencyMs;
    const maxHistorySize = validated.maxHistorySize || this.maxHistorySize;

    const endpointEntry = {
      ...validated,
      intervalMs,
      timeoutMs,
      maxLatencyMs,
      maxHistorySize
    };

    this.endpoints.set(id, endpointEntry);
    this.trackers.set(id, new EndpointTracker(id, { maxHistorySize }));

    this.scheduler.schedule(id, () => this.checkNow(id), intervalMs);

    return this;
  }

  /**
   * Removes an endpoint and cancels its monitoring timer.
   *
   * @param {string} id Endpoint identifier
   * @returns {boolean} True if removed, false if not found
   */
  removeEndpoint(id) {
    if (!this.endpoints.has(id)) {
      return false;
    }

    this.scheduler.cancel(id);
    this.endpoints.delete(id);
    this.trackers.delete(id);
    this.results.delete(id);
    return true;
  }

  /**
   * Starts periodic monitoring.
   *
   * @param {Object} [options={}]
   * @param {boolean} [options.runImmediately=false] Whether to run an initial check immediately
   * @returns {EndpointMonitor} Returns instance for chaining
   */
  start(options = {}) {
    this.scheduler.start(options);
    return this;
  }

  /**
   * Stops all monitoring timers.
   *
   * @returns {EndpointMonitor} Returns instance for chaining
   */
  stop() {
    this.scheduler.stop();
    return this;
  }

  /**
   * Executes an immediate check for a specific endpoint, or all endpoints if id is omitted.
   *
   * @param {string} [id] Optional endpoint id
   * @returns {Promise<Object|Object[]>}
   */
  async checkNow(id) {
    if (id !== undefined && id !== null) {
      return this._probeAndEvaluate(id);
    }

    const ids = Array.from(this.endpoints.keys());
    return Promise.all(ids.map((endpointId) => this._probeAndEvaluate(endpointId)));
  }

  /**
   * Retrieves the latest evaluation status and metrics for a specific endpoint.
   *
   * @param {string} id Endpoint identifier
   * @returns {Object|null} Status report with metrics or null if not registered
   */
  getStatus(id) {
    if (!id || !this.endpoints.has(id)) {
      return null;
    }

    const storedResult = this.results.get(id);
    if (storedResult) {
      return {
        ...storedResult,
        metrics: this.trackers.get(id).getMetrics()
      };
    }

    const endpoint = this.endpoints.get(id);
    const tracker = this.trackers.get(id);

    return {
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      method: endpoint.method,
      status: HealthStatus.UNKNOWN,
      statusCode: null,
      latencyMs: 0,
      error: null,
      probeTimestamp: null,
      evaluatedAt: null,
      metrics: tracker ? tracker.getMetrics() : null
    };
  }

  /**
   * Retrieves current statuses and metrics for all registered endpoints.
   *
   * @returns {Object[]} Array of status reports
   */
  getAllStatuses() {
    return Array.from(this.endpoints.keys()).map((id) => this.getStatus(id));
  }

  /**
   * Exports structured JSON monitoring data with summary statistics.
   *
   * @param {Object} [options={}]
   * @param {boolean} [options.stringify=false] Return stringified JSON instead of object
   * @param {number} [options.indent=2] Indentation spaces when stringified
   * @returns {Object|string}
   */
  exportJSON(options = {}) {
    const statuses = this.getAllStatuses();

    const summary = {
      totalEndpoints: statuses.length,
      up: 0,
      degraded: 0,
      down: 0,
      timeout: 0,
      unknown: 0
    };

    for (const status of statuses) {
      switch (status.status) {
        case HealthStatus.UP:
          summary.up++;
          break;
        case HealthStatus.DEGRADED:
          summary.degraded++;
          break;
        case HealthStatus.DOWN:
          summary.down++;
          break;
        case HealthStatus.TIMEOUT:
          summary.timeout++;
          break;
        default:
          summary.unknown++;
          break;
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      summary,
      endpoints: statuses
    };

    if (options.stringify) {
      return JSON.stringify(report, null, options.indent ?? 2);
    }

    return report;
  }

  /**
   * Returns a JSON-serializable snapshot of monitoring results.
   * @returns {Object}
   */
  toJSON() {
    return this.exportJSON({ stringify: false });
  }

  /**
   * Returns whether monitoring is currently active.
   *
   * @returns {boolean}
   */
  isRunning() {
    return this.scheduler.isRunning();
  }

  /**
   * Returns the count of registered endpoints.
   *
   * @returns {number}
   */
  getEndpointCount() {
    return this.endpoints.size;
  }

  /**
   * Internal worker executing probe, evaluation, metric updates, callbacks, and event notifications.
   * @private
   */
  async _probeAndEvaluate(id) {
    const endpoint = this.endpoints.get(id);
    const tracker = this.trackers.get(id);

    if (!endpoint || !tracker) {
      throw new Error(`Endpoint with id "${id}" is not registered`);
    }

    const probeResult = await probeEndpoint({
      url: endpoint.url,
      method: endpoint.method,
      headers: endpoint.headers,
      body: endpoint.body,
      timeoutMs: endpoint.timeoutMs
    });

    const evalResult = evaluateHealth(probeResult, {
      expectedStatus: endpoint.expectedStatus,
      maxLatencyMs: endpoint.maxLatencyMs
    });

    const { transitions, metrics } = tracker.recordCheck(evalResult);

    const statusReport = {
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      method: endpoint.method,
      status: evalResult.status,
      statusCode: evalResult.statusCode,
      latencyMs: evalResult.latencyMs,
      error: evalResult.error,
      probeTimestamp: evalResult.probeTimestamp,
      evaluatedAt: evalResult.evaluatedAt,
      metrics
    };

    this.results.set(id, statusReport);

    // Dispatch transition events safely
    for (const eventName of transitions) {
      this._safeEmit(eventName, statusReport);
    }

    // Safely invoke endpoint-specific callback hooks if registered
    if (transitions.includes('up') && typeof endpoint.onUp === 'function') {
      try { endpoint.onUp(statusReport); } catch (_) {}
    }
    if (transitions.includes('down') && typeof endpoint.onDown === 'function') {
      try { endpoint.onDown(statusReport); } catch (_) {}
    }
    if (transitions.includes('degraded') && typeof endpoint.onDegraded === 'function') {
      try { endpoint.onDegraded(statusReport); } catch (_) {}
    }
    if (transitions.includes('recovered') && typeof endpoint.onRecovered === 'function') {
      try { endpoint.onRecovered(statusReport); } catch (_) {}
    }

    return statusReport;
  }

  /**
   * Safe event emission helper preventing consumer callback exceptions
   * from crashing the monitoring engine.
   * @private
   */
  _safeEmit(event, ...args) {
    try {
      this.emit(event, ...args);
    } catch (err) {
      if (event !== 'error' && this.listenerCount('error') > 0) {
        try {
          this.emit('error', err);
        } catch {
          // Prevent error handler itself from throwing
        }
      }
    }
  }
}

/**
 * Public Alias for EndpointMonitor.
 */
export const EndpointChecker = EndpointMonitor;
