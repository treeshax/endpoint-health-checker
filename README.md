# endpoint-health-checker

A lightweight, zero-dependency Node.js package for in-process HTTP and HTTPS endpoint monitoring, latency measurement, and health alerting.

---

## Features

- **Zero Runtime Dependencies:** Relies entirely on native Node.js capabilities (`fetch`, `AbortController`, `performance.now()`, `EventEmitter`).
- **In-Process Monitoring:** Probes services directly from your application's network context (ideal for private VPCs, internal services, and microservices).
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

## How to Use

### 1. Basic Background Monitoring

Monitor multiple external or internal APIs at recurring intervals:

```javascript
import { EndpointMonitor } from 'endpoint-health-checker';

const monitor = new EndpointMonitor({
  defaultIntervalMs: 15000, // Check every 15 seconds by default
  timeoutMs: 4000           // 4-second timeout limit
});

// Register endpoints using method chaining
monitor
  .addEndpoint({
    id: 'users-service',
    name: 'User Management API',
    url: 'https://users.service.internal/health',
    method: 'GET',
    expectedStatus: 200,
    maxLatencyMs: 600 // Flag as DEGRADED if slower than 600ms
  })
  .addEndpoint({
    id: 'payment-gateway',
    name: 'Payment Processing Service',
    url: 'https://payments.service.internal/ping',
    intervalMs: 30000 // Custom interval: check every 30s
  });

// Handle health transitions
monitor.on('down', (report) => {
  console.error(`[ALERT] ${report.name} is DOWN! Error: ${report.error}`);
});

monitor.on('degraded', (report) => {
  console.warn(`[WARN] ${report.name} is SLOW! Latency: ${report.latencyMs}ms`);
});

monitor.on('recovered', (report) => {
  console.log(`[OK] ${report.name} has recovered to healthy status.`);
});

// Start background monitoring
monitor.start({ runImmediately: true });

// Stop cleanly when shutting down your app
process.on('SIGTERM', () => {
  monitor.stop();
});
```

---

### 2. Exposing an Aggregated `/health` Route in Express or Fastify

Serve live dependency health to Kubernetes probes, load balancers, or admin dashboards:

```javascript
import express from 'express';
import { EndpointMonitor, HealthStatus } from 'endpoint-health-checker';

const app = express();
const monitor = new EndpointMonitor();

monitor
  .addEndpoint({ id: 'database-api', url: 'https://db.internal.local/ping' })
  .addEndpoint({ id: 'auth-service', url: 'https://auth.internal.local/health' });

monitor.start({ runImmediately: true });

// Aggregated health endpoint
app.get('/health', (req, res) => {
  const report = monitor.exportJSON();
  const hasCriticalFailure = report.summary.down > 0 || report.summary.timeout > 0;

  // Return 503 if any dependency is down, 200 if all healthy or degraded
  res.status(hasCriticalFailure ? 503 : 200).json(report);
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

---

### 3. One-Off / Manual On-Demand Checks (No Background Timers)

Run health checks on-demand (e.g. inside a cron job, AWS Lambda, or CLI script):

```javascript
import { EndpointMonitor } from 'endpoint-health-checker';

const monitor = new EndpointMonitor();

monitor
  .addEndpoint({ id: 'api-1', url: 'https://api1.internal.local/ping' })
  .addEndpoint({ id: 'api-2', url: 'https://api2.internal.local/ping' });

// Check all endpoints immediately in parallel
const results = await monitor.checkNow();

for (const report of results) {
  console.log(`${report.name}: ${report.status} (${report.latencyMs}ms)`);
}

// Check a single endpoint by ID
const singleResult = await monitor.checkNow('api-1');
console.log('Single check:', singleResult.status);
```

---

### 4. Standalone Probing Without the Monitor (`probeEndpoint`)

If you only need to probe a single URL directly without managing instances:

```javascript
import { probeEndpoint } from 'endpoint-health-checker';

const result = await probeEndpoint({
  url: 'https://api.example.com/health',
  method: 'GET',
  timeoutMs: 3000,
  headers: { 'Accept': 'application/json' }
});

console.log(result);
// Output:
// {
//   success: true,
//   statusCode: 200,
//   statusText: 'OK',
//   latencyMs: 142.5,
//   error: null,
//   isTimeout: false,
//   timestamp: '2026-11-22T14:30:00.000Z'
// }
```

---

### 5. Monitoring Authenticated Endpoints

Easily configure Bearer tokens, Basic HTTP auth, or API Keys:

```javascript
// Bearer Token Authentication
monitor.addEndpoint({
  id: 'secure-api',
  url: 'https://secure.internal.local/v1/health',
  auth: { bearer: 'eyJhbGciOiJIUzI1Ni...' }
});

// Basic HTTP Authentication
monitor.addEndpoint({
  id: 'admin-api',
  url: 'https://admin.internal.local/healthz',
  auth: {
    basic: { username: 'service-user', password: 'secret-password' }
  }
});

// Custom API Key Header
monitor.addEndpoint({
  id: 'partner-api',
  url: 'https://partner.api.com/status',
  auth: {
    apiKey: { header: 'X-API-Key', value: 'my-partner-token-123' }
  }
});
```

---

### 6. Custom Status Code Expectations

Define what constitutes a "healthy" response:

```javascript
// Exact status code
monitor.addEndpoint({
  id: 'exact-status',
  url: 'https://api.example.com/empty-health',
  expectedStatus: 204 // UP only if exactly 204 No Content
});

// Array of acceptable status codes
monitor.addEndpoint({
  id: 'multiple-status',
  url: 'https://api.example.com/status',
  expectedStatus: [200, 201, 204]
});

// Status code range string
monitor.addEndpoint({
  id: 'range-status',
  url: 'https://api.example.com/redirect-health',
  expectedStatus: '200-302' // Accept 2xx and redirects
});

// Custom predicate function
monitor.addEndpoint({
  id: 'custom-predicate',
  url: 'https://api.example.com/custom',
  expectedStatus: (statusCode) => statusCode >= 200 && statusCode < 400
});
```

---

### 7. Sending Alerts to Slack or Discord Webhooks

Forward state transitions directly to team chat channels:

```javascript
import { EndpointMonitor } from 'endpoint-health-checker';

const monitor = new EndpointMonitor();

monitor.addEndpoint({
  id: 'billing',
  name: 'Billing API',
  url: 'https://billing.internal.local/health'
});

async function sendSlackAlert(text) {
  try {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (err) {
    console.error('Failed to post webhook alert:', err.message);
  }
}

// Fires only when the service transitions to DOWN (no alert spam)
monitor.on('down', (report) => {
  sendSlackAlert(`🚨 *${report.name} is DOWN!*\nURL: ${report.url}\nError: ${report.error}`);
});

// Fires when service recovers back to UP
monitor.on('recovered', (report) => {
  sendSlackAlert(`✅ *${report.name} has RECOVERED!*\nLatency: ${report.latencyMs}ms`);
});

monitor.start();
```

---

## Configuration Reference

### Global Constructor Options (`new EndpointMonitor(options)`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `defaultIntervalMs` | `number` | `30000` | Default interval between checks in milliseconds |
| `defaultTimeoutMs` | `number` | `5000` | Default request timeout threshold in ms (also accepts `timeoutMs`) |
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
| `expectedStatus` | `number|number[]|string|Function` | `200-299` | Custom status criteria (`200`, `[200, 204]`, `'200-299'`, `(s) => s < 400`) |
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
- **`monitor.isRunning()`**: Returns boolean indicating whether background monitoring is currently active.
- **`monitor.getEndpointCount()`**: Returns total number of registered endpoints.

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
