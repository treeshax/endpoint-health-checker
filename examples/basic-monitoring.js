import { EndpointMonitor } from '../src/index.js';

const monitor = new EndpointMonitor({
  defaultIntervalMs: 5000,
  defaultTimeoutMs: 3000,
  maxHistorySize: 10
});

// Configure sample targets
monitor.addEndpoint({
  id: 'order-service',
  name: 'Internal Order API',
  url: 'https://orders.service.internal/health',
  method: 'GET',
  expectedStatus: 200,
  maxLatencyMs: 1200
});

monitor.addEndpoint({
  id: 'billing-service',
  name: 'Billing Gateway',
  url: 'https://billing.service.internal/ping',
  method: 'GET',
  intervalMs: 8000
});

// Event handlers
monitor.on('up', (report) => {
  console.log(`[UP] ${report.name} is active (${report.latencyMs}ms)`);
});

monitor.on('degraded', (report) => {
  console.log(`[DEGRADED] ${report.name} latency high: ${report.latencyMs}ms`);
});

monitor.on('down', (report) => {
  console.log(`[DOWN] ${report.name} unreachable: ${report.error}`);
});

monitor.on('recovered', (report) => {
  console.log(`[RECOVERED] ${report.name} recovered to healthy state`);
});

export { monitor };
