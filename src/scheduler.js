/**
 * Monitoring Scheduler.
 * Manages periodic execution of asynchronous tasks, prevents overlapping runs,
 * and ensures reliable timer cleanup.
 */

export class Scheduler {
  /**
   * @param {Object} [options={}]
   * @param {Function} [options.onError] Optional error handler for unhandled task rejections
   */
  constructor(options = {}) {
    this.tasks = new Map();
    this.running = false;
    this.onError = typeof options.onError === 'function' ? options.onError : null;
  }

  /**
   * Registers and schedules a periodic task.
   *
   * @param {string} id Unique task identifier
   * @param {Function} task Asynchronous or synchronous task function
   * @param {number} intervalMs Execution interval in milliseconds
   */
  schedule(id, task, intervalMs) {
    if (!id || typeof id !== 'string') {
      throw new TypeError('Task id must be a non-empty string');
    }
    if (typeof task !== 'function') {
      throw new TypeError(`Task callback for "${id}" must be a function`);
    }

    const parsedInterval = Number(intervalMs);
    if (!Number.isFinite(parsedInterval) || parsedInterval <= 0) {
      throw new RangeError(`Interval for "${id}" must be a positive number of milliseconds`);
    }

    // Cancel existing task and clear its timer if already registered
    if (this.tasks.has(id)) {
      this.cancel(id);
    }

    const taskEntry = {
      id,
      task,
      intervalMs: parsedInterval,
      timer: null,
      inFlight: false
    };

    this.tasks.set(id, taskEntry);

    // If scheduler is actively running, start timer for this new task immediately
    if (this.running) {
      this._startTaskTimer(taskEntry);
    }
  }

  /**
   * Alias for schedule.
   */
  registerTask(id, task, intervalMs) {
    return this.schedule(id, task, intervalMs);
  }

  /**
   * Cancels and unregisters a scheduled task.
   * @param {string} id
   * @returns {boolean} True if task existed and was removed
   */
  cancel(id) {
    const taskEntry = this.tasks.get(id);
    if (!taskEntry) {
      return false;
    }

    if (taskEntry.timer) {
      clearTimeout(taskEntry.timer);
      taskEntry.timer = null;
    }
    taskEntry.inFlight = false;
    return this.tasks.delete(id);
  }

  /**
   * Alias for cancel.
   */
  unregisterTask(id) {
    return this.cancel(id);
  }

  /**
   * Starts periodic execution of all registered tasks.
   * @param {Object} [options={}]
   * @param {boolean} [options.runImmediately=false] Whether to trigger an initial execution immediately
   */
  start(options = {}) {
    if (this.running) {
      return; // Prevent duplicate timers if already running
    }

    this.running = true;
    const { runImmediately = false } = options;

    for (const taskEntry of this.tasks.values()) {
      if (runImmediately) {
        this._executeTask(taskEntry).finally(() => {
          if (this.running && this.tasks.has(taskEntry.id)) {
            this._startTaskTimer(taskEntry);
          }
        });
      } else {
        this._startTaskTimer(taskEntry);
      }
    }
  }

  /**
   * Stops all active timers and pauses periodic monitoring.
   */
  stop() {
    this.running = false;
    for (const taskEntry of this.tasks.values()) {
      if (taskEntry.timer) {
        clearTimeout(taskEntry.timer);
        taskEntry.timer = null;
      }
      taskEntry.inFlight = false;
    }
  }

  /**
   * Alias for stop.
   */
  stopAll() {
    this.stop();
  }

  /**
   * Stops monitoring and removes all registered tasks.
   */
  clear() {
    this.stop();
    this.tasks.clear();
  }

  /**
   * Manually triggers immediate execution of a registered task.
   * @param {string} id Task identifier
   * @returns {Promise<boolean>} True if task was executed, false if not found or already running
   */
  async triggerNow(id) {
    const taskEntry = this.tasks.get(id);
    if (!taskEntry) {
      return false;
    }
    if (taskEntry.inFlight) {
      return false; // Skip execution if already in flight
    }

    await this._executeTask(taskEntry);
    return true;
  }

  /**
   * Returns true if a task with the given id exists.
   * @param {string} id
   * @returns {boolean}
   */
  hasTask(id) {
    return this.tasks.has(id);
  }

  /**
   * Returns true if the scheduler is actively running.
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * Returns total count of registered tasks.
   * @returns {number}
   */
  getTaskCount() {
    return this.tasks.size;
  }

  /**
   * Returns an array of registered task IDs.
   * @returns {string[]}
   */
  getTaskIds() {
    return Array.from(this.tasks.keys());
  }

  /**
   * Arms a timer for the next execution tick of a task.
   * @private
   */
  _startTaskTimer(taskEntry) {
    if (!this.running || !this.tasks.has(taskEntry.id)) {
      return;
    }

    if (taskEntry.timer) {
      clearTimeout(taskEntry.timer);
      taskEntry.timer = null;
    }

    const timer = setTimeout(async () => {
      taskEntry.timer = null;

      if (!this.running || !this.tasks.has(taskEntry.id)) {
        return;
      }

      await this._executeTask(taskEntry);

      // Re-arm timer if scheduler is still running and task was not removed
      if (this.running && this.tasks.has(taskEntry.id)) {
        this._startTaskTimer(taskEntry);
      }
    }, taskEntry.intervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    taskEntry.timer = timer;
  }

  /**
   * Executes a task with overlap protection and error containment.
   * @private
   */
  async _executeTask(taskEntry) {
    if (taskEntry.inFlight) {
      return; // Skip execution to avoid overlapping runs
    }

    taskEntry.inFlight = true;
    try {
      await taskEntry.task();
    } catch (err) {
      if (typeof this.onError === 'function') {
        try {
          this.onError(err, taskEntry.id);
        } catch {
          // Do not allow consumer error handlers to crash internal scheduler
        }
      }
    } finally {
      taskEntry.inFlight = false;
    }
  }
}
