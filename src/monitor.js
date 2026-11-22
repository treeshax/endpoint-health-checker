import { EventEmitter } from 'node:events';
import { probeEndpoint } from './prober.js';
import { evaluateHealth, HealthStatus } from './evaluator.js';
import { Scheduler } from './scheduler.js';
import { EndpointTracker, DEFAULT_MAX_HISTORY } from './tracker.js';

/**
 * Validates endpoint configuration for registration.
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
    intervalMs,
    expectedStatus,
    maxHistorySize
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

  let parsedTimeoutMs;
  if (timeoutMs !== undefined && timeoutMs !== null) {
    parsedTimeoutMs = Number(timeoutMs);
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

  let parsedHistory;
  if (maxHistorySize !== undefined && maxHistorySize !== null) {
    parsedHistory = Number(maxHistorySize);
    if (!Number.isInteger(parsedHistory) || parsedHistory <= 0) {
      throw new RangeError('Endpoint "maxHistorySize" must be a positive integer');
    }
  }

  return {
    id: endpointId,
    name: typeof name === 'string' && name.trim() ? name.trim() : endpointId,
    url: parsedUrl.toString(),
    method: normalizedMethod,
    headers: { ...headers },
    body,
    timeoutMs: parsedTimeoutMs,
    intervalMs: parsedIntervalMs,
    expectedStatus,
    maxHistorySize: parsedHistory
  };
}

/**
 * Central Monitoring Manager that coordinates the Prober, Evaluator, Scheduler, and Metrics.
 */
export class EndpointMonitor extends EventEmitter {
  /**
   * @param {Object} [globalConfig={}] Global defaults
   * @param {number} [globalConfig.defaultIntervalMs=30000] Default check interval in ms
   * @param {number} [globalConfig.timeoutMs=5000] Default request timeout in ms
   * @param {number} [globalConfig.maxHistorySize=50] Default maximum history size
   */
  constructor(globalConfig = {}) {
    super();

    const defaultInterval = Number(globalConfig.defaultIntervalMs);
    this.defaultIntervalMs = Number.isFinite(defaultInterval) && defaultInterval > 0
      ? defaultInterval
      : 30000;

    const defaultTimeout = Number(globalConfig.timeoutMs);
    this.defaultTimeoutMs = Number.isFinite(defaultTimeout) && defaultTimeout > 0
      ? defaultTimeout
      : 5000;

    const maxHistory = Number(globalConfig.maxHistorySize);
    this.maxHistorySize = Number.isInteger(maxHistory) && maxHistory > 0
      ? maxHistory
      : DEFAULT_MAX_HISTORY;

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
    const maxHistorySize = validated.maxHistorySize || this.maxHistorySize;

    const endpointEntry = {
      ...validated,
      intervalMs,
      timeoutMs,
      maxHistorySize
    };

    this.endpoints.set(id, endpointEntry);
    this.trackers.set(id, new EndpointTracker(id, { maxHistorySize }));

    // Schedule task with scheduler
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
   * Internal worker executing probe, evaluation, metric updates, and event notifications.
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
      expectedStatus: endpoint.expectedStatus
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
      // If consumer listener throws, forward to 'error' listener if attached
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
