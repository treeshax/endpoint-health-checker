/**
 * Health Evaluation Engine.
 * Interprets probe results and determines endpoint health status.
 */

export const HealthStatus = Object.freeze({
  UP: 'UP',
  DOWN: 'DOWN',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Checks whether a given status code matches expected status criteria.
 * @param {number|null} statusCode
 * @param {number|number[]|string|Function} [expected]
 * @param {boolean} [defaultSuccess=false]
 * @returns {boolean}
 */
function matchesExpectedStatus(statusCode, expected, defaultSuccess) {
  if (statusCode === null || typeof statusCode !== 'number') {
    return false;
  }

  if (expected === undefined || expected === null) {
    return defaultSuccess;
  }

  if (typeof expected === 'number') {
    return statusCode === expected;
  }

  if (Array.isArray(expected)) {
    return expected.includes(statusCode);
  }

  if (typeof expected === 'function') {
    return Boolean(expected(statusCode));
  }

  if (typeof expected === 'string') {
    // Range format: e.g. "200-299"
    const match = expected.trim().match(/^(\d{3})-(\d{3})$/);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      return statusCode >= min && statusCode <= max;
    }
  }

  return false;
}

/**
 * Evaluates a probe result and determines endpoint health status.
 *
 * @param {Object} probeResult Result object from prober
 * @param {Object} [options={}] Evaluation criteria options
 * @param {number|number[]|string|Function} [options.expectedStatus] Expected HTTP status
 * @returns {{
 *   status: 'UP'|'DOWN'|'TIMEOUT'|'UNKNOWN',
 *   statusCode: number|null,
 *   latencyMs: number,
 *   error: string|null,
 *   probeTimestamp: string|null,
 *   evaluatedAt: string
 * }}
 */
export function evaluateHealth(probeResult, options = {}) {
  const evaluatedAt = new Date().toISOString();

  // Handle invalid or null/undefined probe results safely
  if (!probeResult || typeof probeResult !== 'object') {
    return {
      status: HealthStatus.DOWN,
      statusCode: null,
      latencyMs: 0,
      error: 'Invalid or missing probe result',
      probeTimestamp: null,
      evaluatedAt
    };
  }

  const {
    success = false,
    statusCode = null,
    latencyMs = 0,
    error = null,
    isTimeout = false,
    timestamp = null
  } = probeResult;

  const safeStatusCode = typeof statusCode === 'number' && Number.isInteger(statusCode)
    ? statusCode
    : null;
  const safeLatencyMs = typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0
    ? latencyMs
    : 0;
  const safeProbeTimestamp = typeof timestamp === 'string' && timestamp.length > 0
    ? timestamp
    : null;

  // 1. Timeout takes precedence
  if (isTimeout) {
    return {
      status: HealthStatus.TIMEOUT,
      statusCode: safeStatusCode,
      latencyMs: safeLatencyMs,
      error: typeof error === 'string' && error.length > 0 ? error : 'Request timed out',
      probeTimestamp: safeProbeTimestamp,
      evaluatedAt
    };
  }

  // 2. Transport/Network failure (no HTTP response received)
  if (safeStatusCode === null) {
    return {
      status: HealthStatus.DOWN,
      statusCode: null,
      latencyMs: safeLatencyMs,
      error: typeof error === 'string' && error.length > 0 ? error : 'Network failure',
      probeTimestamp: safeProbeTimestamp,
      evaluatedAt
    };
  }

  // 3. Evaluate HTTP response status code against expectations
  const isStatusExpected = matchesExpectedStatus(safeStatusCode, options.expectedStatus, Boolean(success));

  if (isStatusExpected) {
    return {
      status: HealthStatus.UP,
      statusCode: safeStatusCode,
      latencyMs: safeLatencyMs,
      error: null,
      probeTimestamp: safeProbeTimestamp,
      evaluatedAt
    };
  }

  // Status code received does not match expected criteria
  const failureError = typeof error === 'string' && error.length > 0
    ? error
    : `Received unexpected HTTP status code ${safeStatusCode}`;

  return {
    status: HealthStatus.DOWN,
    statusCode: safeStatusCode,
    latencyMs: safeLatencyMs,
    error: failureError,
    probeTimestamp: safeProbeTimestamp,
    evaluatedAt
  };
}
