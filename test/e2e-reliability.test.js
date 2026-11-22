import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EndpointMonitor, HealthStatus, probeEndpoint } from '../src/index.js';

// Pre-generated test certificate & key for 127.0.0.1
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC8THLkM/bPhg6G
qN8DXGwNzKLcSvZzWckR7JXQPqbhvHjrPAb/E1F3+0V5N9WmVmsz6T94fRRl/RGB
66tWm18rM06Q2OCstZaqs3FWWbaQqMGg+XmTZSuHrwbx2cAGfgjn6tzPy8N2uMjj
1NMPg0GMXpeYGMieTMzslj3EbqIo3yQN950HeNiXPV527OuLVWHQ7PiA+Wjp8lbA
YGICCIEuhbyj5XFJH/g3nJF9XGmdJqxtfLST2OWuWpMIeENJ/PkhYecf4z9my33+
XkP1+FcV6KnN22tz/+jkLl/HlZ71DnHEh2u1HrdwNaaCmP53WgkAZKiW6QElsXzK
/29Ycky7AgMBAAECggEANlB284xprQKmPgGIEpgeMvzMHW8iF7PWY+0yaZco3ARZ
fMEb44fXABzitUx9vDVBRwAI5uBted29pxQroBfBI9zw1Kc6Z5cZlrOcBaRrHN8Q
uzY682FDZSf/gNOmqDjCqOL+PpIwF5bFm7JQDzF1PuAqKh08AS12DuhneLnQ3KjA
8KsVP4GkXMzlIambUA4HZipUY0KD9xQFrTkKYffeJ4EX9L9DmuD6JhDv7iasXG1s
b4WzPw0lPaEzbL2C7LnCMf41ooD4FbynO0HV1AK7x1yXbKtG3uF5zMfA8V9RFVmf
y1U6SW7M+S2hePRl4A6gzxEdQlAOIWGhiJSS9R49QQKBgQD9RWWysF3kXFAt40Q2
myRH6k2CnoJyVqiR4smk35VGdf+Uwi+DEYYyrd0yxW0Z9cujzrMtOuTzTaNSKwyC
vPvhhoWCm0dTpRAlOCtrEEKYuTmfN9c80KXSqvNp4R1gvNAeAGYMR6u9sCU3Y/9s
0bTVnKBSchlf85wGBUumbz+QxQKBgQC+U9YyIe1KtD8ssjoixPJ9Z9hpPep19TmP
+vcp+O03C7yoEsw+P8WwNWtvoaLmTu21yK9GEHhieAeER0Da9GcNQxpCDqYtiOYu
TrBJYVCPUML95L2bYQuIiuUwR1HADWnq1DRdK6yGJ7UR+A+QSWPA6KuTvbXypT/I
wNpOCLU/fwKBgQCRaFhc4LjnNMCrt8EgAK4xw6lAhrSp5GrfZu8SA3N2gqR7yYjx
nQwI6J0IWySqNN33a+Ke4yMzNK3BrQl/vfR2pH7eXzvyH+BHHhp/W1SAzkbwzGR8
e+XYL2GUtjPhqEVsFBqCjlthilGznWu2FCfYRBYff3ZmCjzXkA7AvTonaQKBgGK1
TkBf0hZNVvpSUM5ZgD3Dzrv+LYwRq1Hd4bP18uj6gFRWs3CRWHCjs92IYdi6FJST
yTs4LYc8IwHahmtIF+4L4CFkQZEaD+7yRoE4JDS/uPE+YYulD/s3tdeNFXvaORVe
Cu5LSUWmcEUqdr/pIAAba2jLGgMG6wat5kpUP9P3AoGAcGYxBn8m5QJ1t6XqN0nD
j6BjyLM95rczwphmLPzlakP9bco81iBNMTVel1OvgjysuXwvaFAJ+Kfg89RJcsDs
GwwkKXtQKLD+gITChzix4u3DDisz3fsu18xvJoijTta0ah/++Z0ZXBBDKBBYLBE7
FTXi1mqoyLjo3sxs/2MWFyk=
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUdVHOspatFRVkCmqfKgwsqe1mLaMwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTEyMjA5MzAxMloXDTI2MTEy
MzA5MzAxMlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAvExy5DP2z4YOhqjfA1xsDcyi3Er2c1nJEeyV0D6m4bx4
6zwG/xNRd/tFeTfVplZrM+k/eH0UZf0RgeurVptfKzNOkNjgrLWWqrNxVlm2kKjB
oPl5k2Urh68G8dnABn4I5+rcz8vDdrjI49TTD4NBjF6XmBjInkzM7JY9xG6iKN8k
DfedB3jYlz1eduzri1Vh0Oz4gPlo6fJWwGBiAgiBLoW8o+VxSR/4N5yRfVxpnSas
bXy0k9jlrlqTCHhDSfz5IWHnH+M/Zst9/l5D9fhXFeipzdtrc//o5C5fx5We9Q5x
xIdrtR63cDWmgpj+d1oJAGSolukBJbF8yv9vWHJMuwIDAQABo1MwUTAdBgNVHQ4E
FgQUXDQi+y3txSZCygeqpq3TaOAWOBcwHwYDVR0jBBgwFoAUXDQi+y3txSZCygeq
pq3TaOAWOBcwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAQFTw
+XMG+V0qrg5AUtY3byCFe9GFr9AxkWCdiE2NV6RBMiAuAaEpe1K/gJLw9fukTXpL
Bsk+vPO3FUmRRgQNvppn5Yk2xI3FjiuG1bm4lw4+C7GmNl99QN4BXQg8IgDncUZO
ZcJTbEcJMdfg/bj5TCPiDIOJ0hKo1tW90i8EXsyQpec10UakPFCA0ApVli0kScXb
5GMU21L8RMXLpozp7/5MuX+bR2EnTXPFVFdp9psNTRBNyH96QkQs8OCPAiTSkO1o
DDSDxMmIkqD10AL2IdsTCDdNPcs/HplkLM0nxuJ46QbTnyaOt3trhwEi6MXplP1V
+quxbKI7hrd3PV6mqQ==
-----END CERTIFICATE-----`;

describe('Milestone 9: E2E Reliability & Integration Suite', () => {
  let httpServer;
  let httpsServer;
  let httpBaseUrl;
  let httpsBaseUrl;
  let originalTlsReject;

  before(async () => {
    originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // 1. HTTP Server
    httpServer = http.createServer((req, res) => {
      if (req.url === '/head-test') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end();
      } else if (req.url === '/post-test') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: body }));
        });
      } else if (req.url === '/fast-healthy') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else if (req.url === '/slow-healthy') {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Slow OK');
          }
        }, 30);
      } else if (req.url === '/server-error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Fault');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        httpBaseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    // 2. HTTPS Server
    httpsServer = https.createServer({ key: TEST_KEY, cert: TEST_CERT }, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ secure: true, protocol: 'https' }));
    });

    await new Promise((resolve) => {
      httpsServer.listen(0, '127.0.0.1', () => {
        const address = httpsServer.address();
        httpsBaseUrl = `https://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (originalTlsReject !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }

    await Promise.all([
      new Promise((resolve) => httpServer.close(resolve)),
      new Promise((resolve) => httpsServer.close(resolve))
    ]);
  });

  test('1. HTTPS Probing: verifies secure TLS communication', async () => {
    const probe = await probeEndpoint({
      url: `${httpsBaseUrl}/secure-health`,
      method: 'GET'
    });

    assert.equal(probe.success, true);
    assert.equal(probe.statusCode, 200);
    assert.equal(probe.error, null);
    assert.ok(probe.latencyMs >= 0);

    const monitor = new EndpointMonitor();
    monitor.addEndpoint({
      id: 'secure-service',
      url: `${httpsBaseUrl}/secure-health`
    });

    const status = await monitor.checkNow('secure-service');
    assert.equal(status.status, HealthStatus.UP);
    assert.equal(status.statusCode, 200);
  });

  test('2. Supported HTTP Methods: GET, HEAD, and POST with body payloads', async () => {
    const monitor = new EndpointMonitor();

    monitor
      .addEndpoint({
        id: 'head-ep',
        url: `${httpBaseUrl}/head-test`,
        method: 'HEAD'
      })
      .addEndpoint({
        id: 'post-ep',
        url: `${httpBaseUrl}/post-test`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { query: 'healthcheck-payload' }
      });

    const results = await monitor.checkNow();
    assert.equal(results.length, 2);

    const headResult = results.find((r) => r.id === 'head-ep');
    const postResult = results.find((r) => r.id === 'post-ep');

    assert.equal(headResult.status, HealthStatus.UP);
    assert.equal(headResult.statusCode, 200);

    assert.equal(postResult.status, HealthStatus.UP);
    assert.equal(postResult.statusCode, 200);
  });

  test('3. Full Multi-Endpoint Lifecycle, Bounded History, and Timer Cleanup', async () => {
    const monitor = new EndpointMonitor({ defaultIntervalMs: 25, maxHistorySize: 5 });

    monitor
      .addEndpoint({ id: 'ep-fast', url: `${httpBaseUrl}/fast-healthy` })
      .addEndpoint({ id: 'ep-slow', url: `${httpBaseUrl}/slow-healthy`, maxLatencyMs: 15 })
      .addEndpoint({ id: 'ep-err', url: `${httpBaseUrl}/server-error` });

    monitor.start({ runImmediately: true });
    assert.equal(monitor.isRunning(), true);

    // Allow multiple polling cycles to execute across all 3 endpoints
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Stop cleanly
    monitor.stop();
    assert.equal(monitor.isRunning(), false);

    // Verify state across all 3 endpoints
    const fast = monitor.getStatus('ep-fast');
    const slow = monitor.getStatus('ep-slow');
    const err = monitor.getStatus('ep-err');

    assert.equal(fast.status, HealthStatus.UP);
    assert.ok(fast.metrics.totalChecks >= 2);
    assert.equal(fast.metrics.uptimePercentage, 100);

    assert.equal(slow.status, HealthStatus.DEGRADED);
    assert.ok(slow.metrics.degradedChecks >= 2);
    assert.equal(slow.metrics.uptimePercentage, 100);

    assert.equal(err.status, HealthStatus.DOWN);
    assert.ok(err.metrics.failedChecks >= 2);
    assert.equal(err.metrics.uptimePercentage, 0);

    // Verify bounded history limit is respected
    assert.ok(fast.metrics.history.length <= 5);
    assert.ok(slow.metrics.history.length <= 5);
    assert.ok(err.metrics.history.length <= 5);

    // Verify JSON export structure
    const report = monitor.exportJSON();
    assert.equal(report.summary.totalEndpoints, 3);
    assert.equal(report.summary.up, 1);
    assert.equal(report.summary.degraded, 1);
    assert.equal(report.summary.down, 1);
    assert.equal(report.summary.timeout, 0);
    assert.equal(report.summary.unknown, 0);
  });
});
