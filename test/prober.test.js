import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeEndpoint } from '../src/prober.js';

describe('HTTP Prober (src/prober.js)', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Spin up an ephemeral local HTTP test server
    server = http.createServer((req, res) => {
      if (req.url === '/success') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else if (req.url === '/error-500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      } else if (req.url === '/delayed') {
        // Delay response to reliably trigger client timeout
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Delayed response');
          }
        }, 200);
      } else if (req.url === '/custom') {
        if (req.method === 'POST' && req.headers['x-api-key'] === 'secret-token-123') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad Request');
        }
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

  test('1. Successful HTTP response (200 OK)', async () => {
    const result = await probeEndpoint({
      url: `${baseUrl}/success`,
      method: 'GET'
    });

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.statusText, 'OK');
    assert.equal(result.error, null);
    assert.equal(result.isTimeout, false);
    assert.ok(typeof result.latencyMs === 'number' && result.latencyMs >= 0);
    assert.ok(!Number.isNaN(Date.parse(result.timestamp)));
  });

  test('2. Unsuccessful HTTP response (500 Internal Server Error)', async () => {
    const result = await probeEndpoint({
      url: `${baseUrl}/error-500`,
      method: 'GET'
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 500);
    assert.equal(result.statusText, 'Internal Server Error');
    assert.equal(result.error, 'HTTP 500 Internal Server Error');
    assert.equal(result.isTimeout, false);
    assert.ok(result.latencyMs >= 0);
  });

  test('3. Request timeout handling', async () => {
    const timeoutMs = 50;
    const result = await probeEndpoint({
      url: `${baseUrl}/delayed`,
      timeoutMs
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, null);
    assert.equal(result.isTimeout, true);
    assert.ok(result.error.includes(`timed out after ${timeoutMs}ms`));
  });

  test('4. Invalid URL handling', async () => {
    const malformedResult = await probeEndpoint({
      url: 'not-a-valid-url'
    });

    assert.equal(malformedResult.success, false);
    assert.equal(malformedResult.statusCode, null);
    assert.equal(malformedResult.isTimeout, false);
    assert.ok(malformedResult.error.includes('Invalid URL'));

    const unsupportedProtocolResult = await probeEndpoint({
      url: 'ftp://localhost/test'
    });

    assert.equal(unsupportedProtocolResult.success, false);
    assert.ok(unsupportedProtocolResult.error.includes('Unsupported protocol'));
  });

  test('5. Network connection failure (unreachable host/port)', async () => {
    // Attempt connecting to a local port where no listener exists
    const unreachableUrl = 'http://127.0.0.1:59998';
    const result = await probeEndpoint({
      url: unreachableUrl,
      timeoutMs: 1000
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, null);
    assert.equal(result.isTimeout, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });

  test('6. Custom HTTP method (POST) and headers', async () => {
    const result = await probeEndpoint({
      url: `${baseUrl}/custom`,
      method: 'POST',
      headers: {
        'x-api-key': 'secret-token-123',
        'Content-Type': 'application/json'
      },
      body: { action: 'ping' }
    });

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 201);
    assert.equal(result.error, null);
  });

  test('7. Validation of unsupported HTTP method', async () => {
    const result = await probeEndpoint({
      url: `${baseUrl}/success`,
      method: 'DELETE'
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, null);
    assert.ok(result.error.includes('Unsupported HTTP method "DELETE"'));
  });
});
