import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.js';

describe('Monitoring Scheduler (src/scheduler.js)', () => {
  test('1. Registers, inspects, and counts tasks', () => {
    const scheduler = new Scheduler();

    scheduler.schedule('task-1', async () => {}, 1000);
    scheduler.schedule('task-2', async () => {}, 2000);

    assert.equal(scheduler.getTaskCount(), 2);
    assert.equal(scheduler.hasTask('task-1'), true);
    assert.equal(scheduler.hasTask('task-2'), true);
    assert.equal(scheduler.hasTask('unknown'), false);
    assert.deepEqual(scheduler.getTaskIds(), ['task-1', 'task-2']);
  });

  test('2. Validates inputs on schedule()', () => {
    const scheduler = new Scheduler();

    assert.throws(() => scheduler.schedule('', async () => {}, 1000), TypeError);
    assert.throws(() => scheduler.schedule('valid-id', 'not-a-fn', 1000), TypeError);
    assert.throws(() => scheduler.schedule('valid-id', async () => {}, -50), RangeError);
    assert.throws(() => scheduler.schedule('valid-id', async () => {}, 'not-a-number'), RangeError);
  });

  test('3. Executes scheduled tasks periodically', async () => {
    const scheduler = new Scheduler();
    let executionCount = 0;

    scheduler.schedule('endpoint-a', () => {
      executionCount++;
    }, 40);

    scheduler.start();
    assert.equal(scheduler.isRunning(), true);

    // Wait for ~100ms, should execute at least twice
    await new Promise((resolve) => setTimeout(resolve, 110));

    scheduler.stop();
    assert.equal(scheduler.isRunning(), false);

    const countAtStop = executionCount;
    assert.ok(countAtStop >= 2, `Expected at least 2 runs, got ${countAtStop}`);

    // Wait further to ensure no executions occur after stopping
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(executionCount, countAtStop);
  });

  test('4. start({ runImmediately: true }) runs tasks immediately', async () => {
    const scheduler = new Scheduler();
    let ranImmediately = false;

    scheduler.schedule('immediate-task', () => {
      ranImmediately = true;
    }, 5000);

    scheduler.start({ runImmediately: true });

    // Yield to microtask queue for immediate execution
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(ranImmediately, true);
    scheduler.stop();
  });

  test('5. Prevents overlapping executions of the same slow task', async () => {
    const scheduler = new Scheduler();
    let activeConcurrentRuns = 0;
    let maxConcurrentObserved = 0;
    let totalRuns = 0;

    scheduler.schedule('slow-task', async () => {
      activeConcurrentRuns++;
      maxConcurrentObserved = Math.max(maxConcurrentObserved, activeConcurrentRuns);
      totalRuns++;
      // Simulate task taking 80ms while interval is 20ms
      await new Promise((resolve) => setTimeout(resolve, 80));
      activeConcurrentRuns--;
    }, 20);

    scheduler.start({ runImmediately: true });

    // Wait 130ms. With 20ms intervals, an unshielded scheduler would trigger 6 overlapping runs.
    await new Promise((resolve) => setTimeout(resolve, 130));
    scheduler.stop();

    assert.equal(maxConcurrentObserved, 1, 'Concurrent executions must never exceed 1');
    assert.ok(totalRuns >= 1);
  });

  test('6. Canceling a single task halts only that task', async () => {
    const scheduler = new Scheduler();
    let countA = 0;
    let countB = 0;

    scheduler.schedule('task-a', () => { countA++; }, 30);
    scheduler.schedule('task-b', () => { countB++; }, 30);

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Cancel task-a
    const cancelled = scheduler.cancel('task-a');
    assert.equal(cancelled, true);
    assert.equal(scheduler.hasTask('task-a'), false);

    const countAAfterCancel = countA;
    await new Promise((resolve) => setTimeout(resolve, 60));
    scheduler.stop();

    assert.equal(countA, countAAfterCancel);
    assert.ok(countB > countAAfterCancel, 'task-b should continue executing');
  });

  test('7. Handles task exceptions safely and notifies onError', async () => {
    let capturedError = null;
    let capturedId = null;

    const scheduler = new Scheduler({
      onError: (err, id) => {
        capturedError = err;
        capturedId = id;
      }
    });

    let healthyCount = 0;

    scheduler.schedule('failing-task', async () => {
      throw new Error('Simulated network fault in task');
    }, 30);

    scheduler.schedule('healthy-task', () => {
      healthyCount++;
    }, 30);

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    scheduler.stop();

    assert.ok(capturedError instanceof Error);
    assert.equal(capturedError.message, 'Simulated network fault in task');
    assert.equal(capturedId, 'failing-task');
    assert.ok(healthyCount >= 2, 'Healthy task should run unhindered despite peer failure');
  });

  test('8. Idempotent start() does not duplicate timers', async () => {
    const scheduler = new Scheduler();
    let runCount = 0;

    scheduler.schedule('test-task', () => {
      runCount++;
    }, 40);

    scheduler.start();
    scheduler.start(); // Secondary redundant call
    scheduler.start(); // Tertiary redundant call

    await new Promise((resolve) => setTimeout(resolve, 95));
    scheduler.stop();

    // In 95ms with a 40ms interval, exactly 2 ticks should fire
    assert.equal(runCount, 2);
  });

  test('9. triggerNow() executes a task on demand', async () => {
    const scheduler = new Scheduler();
    let triggered = false;

    scheduler.schedule('on-demand', () => {
      triggered = true;
    }, 60000); // 1-minute interval

    const unknownResult = await scheduler.triggerNow('unknown-id');
    assert.equal(unknownResult, false);

    const knownResult = await scheduler.triggerNow('on-demand');
    assert.equal(knownResult, true);
    assert.equal(triggered, true);
  });

  test('10. clear() stops all timers and removes all tasks', () => {
    const scheduler = new Scheduler();
    scheduler.schedule('task-1', () => {}, 100);
    scheduler.schedule('task-2', () => {}, 100);
    scheduler.start();

    assert.equal(scheduler.isRunning(), true);
    assert.equal(scheduler.getTaskCount(), 2);

    scheduler.clear();

    assert.equal(scheduler.isRunning(), false);
    assert.equal(scheduler.getTaskCount(), 0);
  });
});
