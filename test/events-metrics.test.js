import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EndpointMonitor, HealthStatus } from '../src/index.js';
import { EndpointTracker } from '../src/tracker.js';

describe('Status Tracking, Metrics & Events (Milestone 7)', () => {
  let server;
  let baseUrl;
  let dynamicStatus = 200;
  let dynamicDelayMs = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      if (dynamicDelayMs > 0) {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(dynamicStatus, { 'Content-Type': 'text/plain' });
            res.end(`Status ${dynamicStatus}`);
          }
        }, dynamicDelayMs);
        return;
      }

      res.writeHead(dynamicStatus, { 'Content-Type': 'text/plain' });
      res.end(`Status ${dynamicStatus}`);
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

  test('1. EndpointTracker unit: computes metrics and bounds history', () => {
    const tracker = new EndpointTracker('test-ep', { maxHistorySize: 3 });

    // Initial state
    assert.equal(tracker.uptimePercentage, 100);
    assert.equal(tracker.totalChecks, 0);

    // 1st check: UP (50ms)
    tracker.recordCheck({
      status: HealthStatus.UP,
      statusCode: 200,
      latencyMs: 50,
      error: null,
      evaluatedAt: '2026-01-01T00:00:00.000Z'
    });

    assert.equal(tracker.totalChecks, 1);
    assert.equal(tracker.successfulChecks, 1);
    assert.equal(tracker.failedChecks, 0);
    assert.equal(tracker.consecutiveSuccesses, 1);
    assert.equal(tracker.consecutiveFailures, 0);
    assert.equal(tracker.averageLatencyMs, 50);
    assert.equal(tracker.uptimePercentage, 100);
    assert.equal(tracker.lastSuccessAt, '2026-01-01T00:00:00.000Z');

    // 2nd check: DOWN (100ms)
    tracker.recordCheck({
      status: HealthStatus.DOWN,
      statusCode: 500,
      latencyMs: 100,
      error: 'HTTP 500',
      evaluatedAt: '2026-01-01T00:01:00.000Z'
    });

    assert.equal(tracker.totalChecks, 2);
    assert.equal(tracker.successfulChecks, 1);
    assert.equal(tracker.failedChecks, 1);
    assert.equal(tracker.consecutiveSuccesses, 0);
    assert.equal(tracker.consecutiveFailures, 1);
    assert.equal(tracker.averageLatencyMs, 75); // (50 + 100) / 2
    assert.equal(tracker.uptimePercentage, 50); // 1 / 2 * 100
    assert.equal(tracker.lastFailureAt, '2026-01-01T00:01:00.000Z');

    // 3rd check: TIMEOUT (5000ms)
    tracker.recordCheck({
      status: HealthStatus.TIMEOUT,
      statusCode: null,
      latencyMs: 5000,
      error: 'Timeout',
      evaluatedAt: '2026-01-01T00:02:00.000Z'
    });

    assert.equal(tracker.totalChecks, 3);
    assert.equal(tracker.timeoutCount, 1);
    assert.equal(tracker.failedChecks, 2);
    assert.equal(tracker.consecutiveFailures, 2);
    assert.equal(tracker.uptimePercentage, 33.33);

    // 4th check: UP (pushing beyond maxHistorySize of 3)
    tracker.recordCheck({
      status: HealthStatus.UP,
      statusCode: 200,
      latencyMs: 30,
      error: null,
      evaluatedAt: '2026-01-01T00:03:00.000Z'
    });

    const metrics = tracker.getMetrics();
    assert.equal(metrics.history.length, 3, 'History length must be bounded to maxHistorySize');
    // First entry should have been evicted (oldest was status 200, evicted, so first now is DOWN)
    assert.equal(metrics.history[0].status, HealthStatus.DOWN);
    assert.equal(metrics.history[2].status, HealthStatus.UP);
  });

  test('2. Event emission: emits check, up, and down without duplicate down notifications', async () => {
    const monitor = new EndpointMonitor();
    dynamicStatus = 200;
    dynamicDelayMs = 0;

    monitor.addEndpoint({
      id: 'event-ep',
      url: `${baseUrl}/check`
    });

    const eventsFired = [];

    monitor.on('check', (r) => eventsFired.push(`check:${r.status}`));
    monitor.on('up', () => eventsFired.push('up'));
    monitor.on('down', () => eventsFired.push('down'));
    monitor.on('recovered', () => eventsFired.push('recovered'));

    // Check 1: 200 OK -> transitions to UP
    await monitor.checkNow('event-ep');
    assert.deepEqual(eventsFired, ['check:UP', 'up']);

    // Check 2: 200 OK again -> UP remains UP, NO duplicate 'up' event
    await monitor.checkNow('event-ep');
    assert.deepEqual(eventsFired, ['check:UP', 'up', 'check:UP']);

    // Check 3: 500 -> transitions to DOWN
    dynamicStatus = 500;
    await monitor.checkNow('event-ep');
    assert.deepEqual(eventsFired, ['check:UP', 'up', 'check:UP', 'check:DOWN', 'down']);

    // Check 4: 500 again -> DOWN remains DOWN, NO duplicate 'down' event
    await monitor.checkNow('event-ep');
    assert.deepEqual(eventsFired, ['check:UP', 'up', 'check:UP', 'check:DOWN', 'down', 'check:DOWN']);
  });

  test('3. Recovery event: transitions from DOWN to UP emit "recovered" and "up"', async () => {
    const monitor = new EndpointMonitor();
    dynamicStatus = 500;
    dynamicDelayMs = 0;

    monitor.addEndpoint({
      id: 'recovery-ep',
      url: `${baseUrl}/check`
    });

    const transitions = [];
    monitor.on('down', () => transitions.push('down'));
    monitor.on('recovered', () => transitions.push('recovered'));
    monitor.on('up', () => transitions.push('up'));

    // 1st probe: starts failing -> triggers 'down'
    await monitor.checkNow('recovery-ep');
    assert.deepEqual(transitions, ['down']);

    // 2nd probe: recovers to 200 OK -> triggers 'recovered' and 'up'
    dynamicStatus = 200;
    await monitor.checkNow('recovery-ep');
    assert.deepEqual(transitions, ['down', 'recovered', 'up']);
  });

  test('4. Timeout event: detects timeout and recovers when back online', async () => {
    const monitor = new EndpointMonitor();
    dynamicDelayMs = 80; // delay exceeds timeoutMs of 40

    monitor.addEndpoint({
      id: 'timeout-ep',
      url: `${baseUrl}/timeout`,
      timeoutMs: 40
    });

    const eventList = [];
    monitor.on('timeout', () => eventList.push('timeout'));
    monitor.on('recovered', () => eventList.push('recovered'));

    // 1st check: Times out
    await monitor.checkNow('timeout-ep');
    assert.deepEqual(eventList, ['timeout']);

    // 2nd check: Still timing out, no duplicate timeout event
    await monitor.checkNow('timeout-ep');
    assert.deepEqual(eventList, ['timeout']);

    // 3rd check: Delay cleared, service recovers
    dynamicDelayMs = 0;
    dynamicStatus = 200;
    await monitor.checkNow('timeout-ep');
    assert.deepEqual(eventList, ['timeout', 'recovered']);
  });

  test('5. Safe event containment: listener exceptions do not crash monitor or abort checks', async () => {
    const monitor = new EndpointMonitor();
    dynamicStatus = 200;
    dynamicDelayMs = 0;

    monitor.addEndpoint({
      id: 'faulty-listener-ep',
      url: `${baseUrl}/safe`
    });

    // Attach a buggy listener that throws an unhandled exception
    monitor.on('check', () => {
      throw new Error('User callback bug inside event listener!');
    });

    // Probing should complete successfully despite the listener throwing
    const result = await monitor.checkNow('faulty-listener-ep');
    assert.equal(result.status, HealthStatus.UP);
    assert.equal(result.statusCode, 200);

    const status = monitor.getStatus('faulty-listener-ep');
    assert.equal(status.metrics.totalChecks, 1);
  });
});
