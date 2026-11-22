import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EndpointMonitor, EndpointChecker, HealthStatus } from '../src/index.js';

describe('Monitoring Manager & Public API (src/monitor.js)', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/api/failing') {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('1. EndpointChecker is exported as an alias of EndpointMonitor', () => {
    assert.equal(EndpointChecker, EndpointMonitor);
    const monitor = new EndpointChecker();
    assert.ok(monitor instanceof EndpointMonitor);
  });

  test('2. Validates endpoint registration and prevents duplicates', () => {
    const monitor = new EndpointMonitor();

    // Missing or invalid URL
    assert.throws(() => monitor.addEndpoint({}), TypeError);
    assert.throws(() => monitor.addEndpoint({ url: 'not-a-url' }), TypeError);
    assert.throws(() => monitor.addEndpoint({ url: 'ftp://localhost/test' }), TypeError);

    // Unsupported method
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/api/health`, method: 'DELETE' }), TypeError);

    // Invalid interval
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/api/health`, intervalMs: -100 }), RangeError);

    // Valid registration with method chaining
    const returned = monitor.addEndpoint({
      id: 'test-health',
      name: 'Health Service',
      url: `${baseUrl}/api/health`
    });
    assert.equal(returned, monitor, 'addEndpoint should return instance for chaining');
    assert.equal(monitor.getEndpointCount(), 1);

    // Prevent duplicate ID registration
    assert.throws(
      () => monitor.addEndpoint({ id: 'test-health', url: `${baseUrl}/api/health` }),
      /already registered/
    );
  });

  test('3. getStatus() returns UNKNOWN status before any check is executed', () => {
    const monitor = new EndpointMonitor();
    monitor.addEndpoint({
      id: 'untested-service',
      url: `${baseUrl}/api/health`
    });

    const status = monitor.getStatus('untested-service');
    assert.equal(status.id, 'untested-service');
    assert.equal(status.status, HealthStatus.UNKNOWN);
    assert.equal(status.statusCode, null);
    assert.equal(status.probeTimestamp, null);
  });

  test('4. checkNow(id) manually probes and evaluates a single endpoint', async () => {
    const monitor = new EndpointMonitor();
    monitor.addEndpoint({
      id: 'healthy-endpoint',
      url: `${baseUrl}/api/health`
    });

    const result = await monitor.checkNow('healthy-endpoint');
    assert.equal(result.id, 'healthy-endpoint');
    assert.equal(result.status, HealthStatus.UP);
    assert.equal(result.statusCode, 200);
    assert.ok(result.latencyMs >= 0);
    assert.equal(result.error, null);
    assert.ok(typeof result.evaluatedAt === 'string');

    // Stored status should match the probe result
    const stored = monitor.getStatus('healthy-endpoint');
    assert.equal(stored.status, HealthStatus.UP);
    assert.equal(stored.statusCode, 200);
  });

  test('5. checkNow() with no arguments executes checks for all endpoints', async () => {
    const monitor = new EndpointMonitor();
    monitor
      .addEndpoint({ id: 'ep-1', url: `${baseUrl}/api/health` })
      .addEndpoint({ id: 'ep-2', url: `${baseUrl}/api/failing` });

    const results = await monitor.checkNow();
    assert.equal(Array.isArray(results), true);
    assert.equal(results.length, 2);

    const ep1 = results.find((r) => r.id === 'ep-1');
    const ep2 = results.find((r) => r.id === 'ep-2');

    assert.equal(ep1.status, HealthStatus.UP);
    assert.equal(ep1.statusCode, 200);

    assert.equal(ep2.status, HealthStatus.DOWN);
    assert.equal(ep2.statusCode, 503);
  });

  test('6. getAllStatuses() returns statuses for all registered endpoints', async () => {
    const monitor = new EndpointMonitor();
    monitor
      .addEndpoint({ id: 'all-1', url: `${baseUrl}/api/health` })
      .addEndpoint({ id: 'all-2', url: `${baseUrl}/api/failing` });

    await monitor.checkNow('all-1');

    const allStatuses = monitor.getAllStatuses();
    assert.equal(allStatuses.length, 2);

    const s1 = allStatuses.find((s) => s.id === 'all-1');
    const s2 = allStatuses.find((s) => s.id === 'all-2');

    assert.equal(s1.status, HealthStatus.UP);
    assert.equal(s2.status, HealthStatus.UNKNOWN); // not checked yet
  });

  test('7. removeEndpoint(id) unregisters endpoint and cancels its task', async () => {
    const monitor = new EndpointMonitor();
    monitor.addEndpoint({ id: 'to-remove', url: `${baseUrl}/api/health` });

    assert.equal(monitor.getEndpointCount(), 1);
    const removed = monitor.removeEndpoint('to-remove');
    assert.equal(removed, true);
    assert.equal(monitor.getEndpointCount(), 0);
    assert.equal(monitor.getStatus('to-remove'), null);

    const removeAgain = monitor.removeEndpoint('to-remove');
    assert.equal(removeAgain, false);
  });

  test('8. start() and stop() control periodic monitoring', async () => {
    const monitor = new EndpointMonitor();
    let probeCount = 0;

    // Use a custom route to count requests
    const checkUrl = `${baseUrl}/api/health`;
    monitor.addEndpoint({
      id: 'timed-endpoint',
      url: checkUrl,
      intervalMs: 40
    });

    monitor.start({ runImmediately: true });
    assert.equal(monitor.isRunning(), true);

    await new Promise((resolve) => setTimeout(resolve, 110));
    monitor.stop();
    assert.equal(monitor.isRunning(), false);

    const statusAfterStop = monitor.getStatus('timed-endpoint');
    assert.equal(statusAfterStop.status, HealthStatus.UP);
  });
});
