# endpoint-health-checker

A lightweight, zero-dependency Node.js package for in-process HTTP and HTTPS endpoint monitoring, latency measurement, and health alerting.

---

## Features

- **Zero Runtime Dependencies:** Relies entirely on native Node.js capabilities (`fetch`, `AbortController`, `performance.now()`, `EventEmitter`).
- **In-Process Monitoring:** Probes services directly from your application's network context (useful for private VPCs, internal services, and microservices).
- **Flexible Methods:** Supports `GET`, `HEAD`, and `POST` requests with configurable headers and payloads.
- **Latency & Degraded Health Checks:** Detects high latency thresholds and flags slow responses as `DEGRADED`.
- **Anti-Spam Event Engine:** Dispatches status transition notifications (`up`, `down`, `timeout`, `degraded`, `recovered`) while suppressing duplicate consecutive alerts.
- **Detailed Metrics:** Tracks total checks, success/failure counts, consecutive streaks, running average latency, uptime percentage, and bounded history.
- **Safe Execution:** Implements strict error boundaries and overlap prevention so slow or failing probes never crash host processes.
- **Structured Reporting:** Instant JSON summaries via `exportJSON()` and `toJSON()`.

---

## Installation

```bash
npm install endpoint-health-checker
```

*Requires Node.js `>= 18.0.0`.*

---

## Quick Start

```javascript
import { EndpointMonitor } from 'endpoint-health-checker';

const monitor = new EndpointMonitor({
  defaultIntervalMs: 30000, // 30 seconds
  timeoutMs: 5000           // 5 seconds
});

// Register endpoints
monitor.addEndpoint({
  id: 'payment-gateway',
  name: 'Payment Service API',
  url: 'https://api.paymentservice.example.com/health',
  method: 'GET',
  expectedStatus: 200,
  maxLatencyMs: 800
});

monitor.addEndpoint({
  id: 'auth-service',
  name: 'Internal Auth Service',
  url: 'https://auth.internal.local/ping',
  intervalMs: 15000,
  auth: { bearer: 'service-token' }
});

// Listen for health transition events
monitor.on('down', (report) => {
  console.error(`[ALERT] ${report.name} is DOWN: ${report.error}`);
});

monitor.on('degraded', (report) => {
  console.warn(`[WARN] ${report.name} is SLOW (${report.latencyMs}ms)`);
});

monitor.on('recovered', (report) => {
  console.log(`[RECOVERED] ${report.name} is back online!`);
});

// Start periodic checks
monitor.start({ runImmediately: true });

// Graceful shutdown
process.on('SIGTERM', () => {
  monitor.stop();
});
```

---

## Configuration Reference

### Global Constructor Options (`new EndpointMonitor(options)`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `defaultIntervalMs` | `number` | `30000` | Default interval between checks in milliseconds |
| `timeoutMs` | `number` | `5000` | Default request timeout threshold in milliseconds |
| `maxLatencyMs` | `number` | `undefined` | Optional global threshold for `DEGRADED` status |
| `maxHistorySize` | `number` | `50` | Maximum number of historical records to keep per endpoint |

### Endpoint Options (`monitor.addEndpoint(options)`)

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | *(Required)* | Target URL (`http:` or `https:`) |
| `id` | `string` | `url` | Unique identifier for the endpoint |
| `name` | `string` | `id` | Human-readable label for reporting |
| `method` | `string` | `'GET'` | HTTP method (`GET`, `HEAD`, `POST`) |
| `headers` | `object` | `{}` | Key-value dictionary of HTTP request headers |
| `body` | `string|object` | `undefined` | Request body payload for `POST` requests |
| `intervalMs` | `number` | `defaultIntervalMs` | Override check interval for this endpoint |
| `timeoutMs` | `number` | `defaultTimeoutMs` | Override timeout for this endpoint |
| `expectedStatus` | `number|number[]|string|Function` | `200-299` | Custom status criteria (e.g. `200`, `[200, 204]`, `'200-299'`, `(s) => s < 400`) |
| `maxLatencyMs` | `number` | `undefined` | Latency ceiling in ms; marks response `DEGRADED` if exceeded |
| `maxHistorySize` | `number` | `50` | Bound for recent check history queue |
| `auth` | `object` | `undefined` | Auth shortcut: `{ bearer }`, `{ basic: { username, password } }`, or `{ apiKey: { header, value } }` |
| `onUp` | `Function` | `undefined` | Callback invoked when endpoint transitions to `UP` |
| `onDown` | `Function` | `undefined` | Callback invoked when endpoint transitions to `DOWN` |
| `onDegraded` | `Function` | `undefined` | Callback invoked when endpoint transitions to `DEGRADED` |
| `onRecovered` | `Function` | `undefined` | Callback invoked when endpoint recovers from failure |

---

## Lifecycle Events

`EndpointMonitor` extends the native Node.js `EventEmitter`. Listeners receive the status report for the affected endpoint.

- **`check`**: Dispatched on every completed probe.
- **`up`**: Dispatched when an endpoint enters `UP` status.
- **`down`**: Dispatched when an endpoint transitions to `DOWN` (consecutive failures do not re-emit).
- **`timeout`**: Dispatched when an endpoint request exceeds its deadline.
- **`degraded`**: Dispatched when latency exceeds `maxLatencyMs`.
- **`recovered`**: Dispatched when an endpoint returns to a healthy state after being down or timed out.
- **`error`**: Dispatched if an internal scheduler or network dispatch error occurs.

---

## Public Methods

- **`monitor.addEndpoint(config)`**: Registers an endpoint. Returns `this` for chaining.
- **`monitor.removeEndpoint(id)`**: Deregisters an endpoint and clears its timer.
- **`monitor.start({ runImmediately = false })`**: Starts background polling.
- **`monitor.stop()`**: Stops all active timers.
- **`monitor.checkNow(id?)`**: Triggers immediate check for one or all endpoints.
- **`monitor.getStatus(id)`**: Returns current status and metrics for an endpoint.
- **`monitor.getAllStatuses()`**: Returns status reports for all endpoints.
- **`monitor.exportJSON(options?)`**: Returns an aggregated JSON report object or string.
- **`monitor.toJSON()`**: Returns JSON-serializable report.

---

## Metrics Structure

Each endpoint report contains a `metrics` block:

```json
{
  "totalChecks": 120,
  "successfulChecks": 118,
  "degradedChecks": 2,
  "failedChecks": 0,
  "timeoutCount": 0,
  "consecutiveSuccesses": 45,
  "consecutiveFailures": 0,
  "lastSuccessAt": "2026-11-22T14:30:00.000Z",
  "lastFailureAt": null,
  "averageLatencyMs": 42.15,
  "uptimePercentage": 100.0,
  "history": [ ... ]
}
```

---

## Testing

Run the test suite using Node.js built-in test runner:

```bash
npm test
```

---

## License

MIT
