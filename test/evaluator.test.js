import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHealth, HealthStatus } from '../src/evaluator.js';

describe('Health Evaluation Engine (src/evaluator.js)', () => {
  const sampleTimestamp = '2026-11-22T12:00:00.000Z';

  test('1. Successful HTTP response (200 OK) evaluates to UP', () => {
    const probeResult = {
      success: true,
      statusCode: 200,
      statusText: 'OK',
      latencyMs: 45.2,
      error: null,
      isTimeout: false,
      timestamp: sampleTimestamp
    };

    const evaluation = evaluateHealth(probeResult);

    assert.equal(evaluation.status, HealthStatus.UP);
    assert.equal(evaluation.statusCode, 200);
    assert.equal(evaluation.latencyMs, 45.2);
    assert.equal(evaluation.error, null);
    assert.equal(evaluation.probeTimestamp, sampleTimestamp);
    assert.ok(typeof evaluation.evaluatedAt === 'string');
    assert.ok(!Number.isNaN(Date.parse(evaluation.evaluatedAt)));
  });

  test('2. Unsuccessful HTTP response (500 Internal Server Error) evaluates to DOWN', () => {
    const probeResult = {
      success: false,
      statusCode: 500,
      statusText: 'Internal Server Error',
      latencyMs: 82.5,
      error: 'HTTP 500 Internal Server Error',
      isTimeout: false,
      timestamp: sampleTimestamp
    };

    const evaluation = evaluateHealth(probeResult);

    assert.equal(evaluation.status, HealthStatus.DOWN);
    assert.equal(evaluation.statusCode, 500);
    assert.equal(evaluation.latencyMs, 82.5);
    assert.equal(evaluation.error, 'HTTP 500 Internal Server Error');
    assert.equal(evaluation.probeTimestamp, sampleTimestamp);
  });

  test('3. Network connection failure evaluates to DOWN with error preserved', () => {
    const probeResult = {
      success: false,
      statusCode: null,
      statusText: null,
      latencyMs: 12.1,
      error: 'connect ECONNREFUSED 127.0.0.1:59998',
      isTimeout: false,
      timestamp: sampleTimestamp
    };

    const evaluation = evaluateHealth(probeResult);

    assert.equal(evaluation.status, HealthStatus.DOWN);
    assert.equal(evaluation.statusCode, null);
    assert.equal(evaluation.latencyMs, 12.1);
    assert.equal(evaluation.error, 'connect ECONNREFUSED 127.0.0.1:59998');
    assert.equal(evaluation.probeTimestamp, sampleTimestamp);
  });

  test('4. Request timeout evaluates to TIMEOUT', () => {
    const probeResult = {
      success: false,
      statusCode: null,
      statusText: null,
      latencyMs: 5001.2,
      error: 'Request timed out after 5000ms',
      isTimeout: true,
      timestamp: sampleTimestamp
    };

    const evaluation = evaluateHealth(probeResult);

    assert.equal(evaluation.status, HealthStatus.TIMEOUT);
    assert.equal(evaluation.statusCode, null);
    assert.equal(evaluation.latencyMs, 5001.2);
    assert.equal(evaluation.error, 'Request timed out after 5000ms');
    assert.equal(evaluation.probeTimestamp, sampleTimestamp);
  });

  test('5. Handles invalid or missing inputs safely without throwing', () => {
    const inputs = [null, undefined, '', 123, true, {}];

    for (const input of inputs) {
      const evaluation = evaluateHealth(input);

      assert.ok(evaluation.status === HealthStatus.DOWN);
      assert.equal(evaluation.statusCode, null);
      assert.equal(evaluation.latencyMs, 0);
      assert.ok(typeof evaluation.error === 'string');
      assert.ok(typeof evaluation.evaluatedAt === 'string');
    }
  });

  test('6. Handles missing probe fields and applies safe defaults', () => {
    const incompleteProbe = {
      success: true,
      statusCode: 200
      // latencyMs, error, isTimeout, timestamp omitted
    };

    const evaluation = evaluateHealth(incompleteProbe);

    assert.equal(evaluation.status, HealthStatus.UP);
    assert.equal(evaluation.statusCode, 200);
    assert.equal(evaluation.latencyMs, 0);
    assert.equal(evaluation.error, null);
    assert.equal(evaluation.probeTimestamp, null);
    assert.ok(typeof evaluation.evaluatedAt === 'string');
  });

  test('7. Timestamp handling preserves probe timestamp and generates evaluatedAt', () => {
    const beforeEvaluation = Date.now();
    const evaluation = evaluateHealth({
      success: true,
      statusCode: 200,
      timestamp: '2026-01-01T00:00:00.000Z'
    });
    const afterEvaluation = Date.now();

    assert.equal(evaluation.probeTimestamp, '2026-01-01T00:00:00.000Z');
    const evalTime = Date.parse(evaluation.evaluatedAt);
    assert.ok(evalTime >= beforeEvaluation && evalTime <= afterEvaluation);
  });

  test('8. Supports custom expectedStatus criteria (number, array, range, function)', () => {
    // Single number match
    const eval204 = evaluateHealth(
      { success: false, statusCode: 204, timestamp: sampleTimestamp },
      { expectedStatus: 204 }
    );
    assert.equal(eval204.status, HealthStatus.UP);

    // Single number mismatch
    const evalMismatch = evaluateHealth(
      { success: true, statusCode: 200, timestamp: sampleTimestamp },
      { expectedStatus: 201 }
    );
    assert.equal(evalMismatch.status, HealthStatus.DOWN);

    // Array of accepted status codes
    const evalArrayMatch = evaluateHealth(
      { success: true, statusCode: 202, timestamp: sampleTimestamp },
      { expectedStatus: [200, 201, 202] }
    );
    assert.equal(evalArrayMatch.status, HealthStatus.UP);

    // Range string "200-299"
    const evalRangeMatch = evaluateHealth(
      { success: true, statusCode: 299, timestamp: sampleTimestamp },
      { expectedStatus: '200-299' }
    );
    assert.equal(evalRangeMatch.status, HealthStatus.UP);

    const evalRangeMismatch = evaluateHealth(
      { success: false, statusCode: 301, timestamp: sampleTimestamp },
      { expectedStatus: '200-299' }
    );
    assert.equal(evalRangeMismatch.status, HealthStatus.DOWN);

    // Custom predicate function
    const evalPredicate = evaluateHealth(
      { success: false, statusCode: 304, timestamp: sampleTimestamp },
      { expectedStatus: (code) => code < 400 }
    );
    assert.equal(evalPredicate.status, HealthStatus.UP);
  });
});
