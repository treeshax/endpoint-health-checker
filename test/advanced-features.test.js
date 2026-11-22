import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EndpointMonitor, HealthStatus } from '../src/index.js';

describe('Advanced Configuration & Reporting (Milestone 8)', () => {
  let server;
  let baseUrl;
  let delayMs = 0;
  let lastReceivedHeaders = {};

  before(async () => {
    server = http.createServer((req, res) => {
      lastReceivedHeaders = { ...req.headers };

      if (delayMs > 0) {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }
        }, delayMs);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
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

  test('1. Detects DEGRADED status when latency exceeds maxLatencyMs', async () => {
    const monitor = new EndpointMonitor();
    delayMs = 60; // 60ms response delay

    monitor.addEndpoint({
      id: 'slow-endpoint',
      url: `${baseUrl}/slow`,
      maxLatencyMs: 30 // Threshold is 30ms
    });

    const report = await monitor.checkNow('slow-endpoint');

    assert.equal(report.status, HealthStatus.DEGRADED);
    assert.equal(report.statusCode, 200);
    assert.ok(report.latencyMs >= 50);
    assert.ok(report.error.includes('Latency threshold exceeded'));

    const status = monitor.getStatus('slow-endpoint');
    assert.equal(status.metrics.degradedChecks, 1);
    assert.equal(status.metrics.uptimePercentage, 100); // 200 OK is reachable
  });

  test('2. Transitions to DEGRADED and emits "degraded" and "recovered"', async () => {
    const monitor = new EndpointMonitor();
    delayMs = 70;

    monitor.addEndpoint({
      id: 'transition-degraded',
      url: `${baseUrl}/test`,
      maxLatencyMs: 30
    });

    const events = [];
    monitor.on('degraded', () => events.push('degraded'));
    monitor.on('up', () => events.push('up'));

    // Check 1: Exceeds threshold -> triggers 'degraded'
    await monitor.checkNow('transition-degraded');
    assert.deepEqual(events, ['degraded']);

    // Check 2: Still degraded -> no duplicate 'degraded'
    await monitor.checkNow('transition-degraded');
    assert.deepEqual(events, ['degraded']);

    // Check 3: Response speeds up -> recovers to 'up'
    delayMs = 0;
    await monitor.checkNow('transition-degraded');
    assert.deepEqual(events, ['degraded', 'up']);
  });

  test('3. Convenience authentication: Bearer and Basic auth', async () => {
    const monitor = new EndpointMonitor();
    delayMs = 0;

    // Bearer token
    monitor.addEndpoint({
      id: 'bearer-ep',
      url: `${baseUrl}/auth-bearer`,
      auth: { bearer: 'my-secret-jwt' }
    });

    await monitor.checkNow('bearer-ep');
    assert.equal(lastReceivedHeaders['authorization'], 'Bearer my-secret-jwt');

    // Basic auth
    monitor.addEndpoint({
      id: 'basic-ep',
      url: `${baseUrl}/auth-basic`,
      auth: { basic: { username: 'admin', password: 'password123' } }
    });

    await monitor.checkNow('basic-ep');
    const expectedEncoded = Buffer.from('admin:password123').toString('base64');
    assert.equal(lastReceivedHeaders['authorization'], `Basic ${expectedEncoded}`);

    // API Key in custom header
    monitor.addEndpoint({
      id: 'apikey-ep',
      url: `${baseUrl}/auth-apikey`,
      auth: { apiKey: { header: 'X-Service-Key', value: 'secret-key-999' } }
    });

    await monitor.checkNow('apikey-ep');
    assert.equal(lastReceivedHeaders['x-service-key'], 'secret-key-999');
  });

  test('4. Endpoint-level callbacks: onUp, onDegraded, onDown, onRecovered', async () => {
    let calledOnUp = false;
    let calledOnDegraded = false;

    const monitor = new EndpointMonitor();
    delayMs = 0;

    monitor.addEndpoint({
      id: 'callback-ep',
      url: `${baseUrl}/callback`,
      maxLatencyMs: 25,
      onUp: (report) => {
        calledOnUp = true;
        assert.equal(report.status, HealthStatus.UP);
      },
      onDegraded: (report) => {
        calledOnDegraded = true;
        assert.equal(report.status, HealthStatus.DEGRADED);
      }
    });

    // Run when fast -> invokes onUp
    await monitor.checkNow('callback-ep');
    assert.equal(calledOnUp, true);
    assert.equal(calledOnDegraded, false);

    // Run when slow -> invokes onDegraded
    delayMs = 50;
    await monitor.checkNow('callback-ep');
    assert.equal(calledOnDegraded, true);
  });

  test('5. exportJSON() and toJSON() produce structured summary reports', async () => {
    const monitor = new EndpointMonitor();
    delayMs = 0;

    monitor
      .addEndpoint({ id: 'srv-1', url: `${baseUrl}/1` })
      .addEndpoint({ id: 'srv-2', url: `${baseUrl}/2`, maxLatencyMs: 20 });

    delayMs = 50;
    await monitor.checkNow('srv-2'); // will be DEGRADED

    const reportObj = monitor.exportJSON();
    assert.ok(typeof reportObj.generatedAt === 'string');
    assert.equal(reportObj.summary.totalEndpoints, 2);
    assert.equal(reportObj.summary.degraded, 1);
    assert.equal(reportObj.summary.unknown, 1); // srv-1 not checked yet
    assert.equal(reportObj.endpoints.length, 2);

    // Stringified export
    const jsonString = monitor.exportJSON({ stringify: true, indent: 2 });
    assert.ok(typeof jsonString === 'string');
    const parsed = JSON.parse(jsonString);
    assert.equal(parsed.summary.totalEndpoints, 2);

    // toJSON support
    const toJsonObject = monitor.toJSON();
    assert.deepEqual(toJsonObject.summary, reportObj.summary);
  });

  test('6. Validates advanced configuration inputs', () => {
    const monitor = new EndpointMonitor();

    // Invalid maxLatencyMs
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/test`, maxLatencyMs: -10 }), RangeError);
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/test`, maxLatencyMs: 'invalid' }), RangeError);

    // Invalid auth
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/test`, auth: 'not-an-obj' }), TypeError);
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/test`, auth: { bearer: 123 } }), TypeError);
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/test`, auth: { basic: { username: '' } } }), TypeError);

    // Invalid callbacks
    assert.throws(() => monitor.addEndpoint({ url: `${baseUrl}/test`, onUp: 'not-a-func' }), TypeError);
  });
});
