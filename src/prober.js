/**
 * Dispatches HTTP/HTTPS requests, measures latency, and handles timeouts.
 */

const SUPPORTED_METHODS = Object.freeze(['GET', 'HEAD', 'POST']);
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_METHOD = 'GET';

/**
 * Validates probe input configuration before dispatching network requests.
 * @param {Object} config
 * @returns {{ valid: boolean, error?: string, parsedUrl?: URL, method?: string, timeoutMs?: number }}
 */
function validateProbeConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Probe configuration must be an object' };
  }

  const { url, method = DEFAULT_METHOD, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Endpoint URL is required and must be a string' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    return { valid: false, error: `Invalid URL: ${err.message}` };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol "${parsedUrl.protocol}". Only "http:" and "https:" are supported`
    };
  }

  const normalizedMethod = String(method).toUpperCase();
  if (!SUPPORTED_METHODS.includes(normalizedMethod)) {
    return {
      valid: false,
      error: `Unsupported HTTP method "${method}". Supported methods are: ${SUPPORTED_METHODS.join(', ')}`
    };
  }

  const parsedTimeout = Number(timeoutMs);
  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    return {
      valid: false,
      error: 'Timeout must be a positive number of milliseconds'
    };
  }

  return {
    valid: true,
    parsedUrl,
    method: normalizedMethod,
    timeoutMs: parsedTimeout
  };
}

/**
 * Probes a single HTTP/HTTPS endpoint and returns standardized metrics and status.
 *
 * @param {Object} endpoint Target configuration
 * @param {string} endpoint.url Endpoint target URL (http/https)
 * @param {('GET'|'HEAD'|'POST')} [endpoint.method='GET'] HTTP method
 * @param {Record<string, string>} [endpoint.headers={}] Request headers
 * @param {string|Object} [endpoint.body] Request payload for POST
 * @param {number} [endpoint.timeoutMs=5000] Request timeout threshold
 * @returns {Promise<{
 *   success: boolean,
 *   statusCode: number|null,
 *   statusText: string|null,
 *   latencyMs: number,
 *   error: string|null,
 *   isTimeout: boolean,
 *   timestamp: string
 * }>}
 */
export async function probeEndpoint(endpoint) {
  const timestamp = new Date().toISOString();
  const validation = validateProbeConfig(endpoint);

  if (!validation.valid) {
    return {
      success: false,
      statusCode: null,
      statusText: null,
      latencyMs: 0,
      error: validation.error,
      isTimeout: false,
      timestamp
    };
  }

  const { parsedUrl, method, timeoutMs } = validation;
  const controller = new AbortController();
  let isTimeout = false;

  const timer = setTimeout(() => {
    isTimeout = true;
    controller.abort();
  }, timeoutMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  const startTime = performance.now();

  try {
    const fetchOptions = {
      method,
      headers: endpoint.headers || {},
      signal: controller.signal,
      redirect: 'follow'
    };

    if (method === 'POST' && endpoint.body !== undefined) {
      fetchOptions.body = typeof endpoint.body === 'string'
        ? endpoint.body
        : JSON.stringify(endpoint.body);
    }

    const response = await fetch(parsedUrl.toString(), fetchOptions);
    const latencyMs = Number((performance.now() - startTime).toFixed(2));

    // Safely drain or cancel response stream to prevent connection/socket hanging
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // Stream cancel errors can be safely ignored
      }
    }

    const isSuccess = response.ok; // HTTP 200-299 status code range

    return {
      success: isSuccess,
      statusCode: response.status,
      statusText: response.statusText || null,
      latencyMs,
      error: isSuccess
        ? null
        : (response.statusText ? `HTTP ${response.status} ${response.statusText}` : `HTTP status ${response.status}`),
      isTimeout: false,
      timestamp
    };
  } catch (err) {
    const latencyMs = Number((performance.now() - startTime).toFixed(2));
    const wasAbortedDueToTimeout = isTimeout || err.name === 'AbortError' || err.name === 'TimeoutError';

    return {
      success: false,
      statusCode: null,
      statusText: null,
      latencyMs,
      error: wasAbortedDueToTimeout
        ? `Request timed out after ${timeoutMs}ms`
        : (err.message || String(err)),
      isTimeout: wasAbortedDueToTimeout,
      timestamp
    };
  } finally {
    clearTimeout(timer);
  }
}
