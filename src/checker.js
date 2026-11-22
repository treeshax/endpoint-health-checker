import { EventEmitter } from 'node:events';

/**
 * Main orchestrator class providing the public API for endpoint monitoring.
 */
export class EndpointChecker extends EventEmitter {
  /**
   * @param {Object} [config={}] Global configuration options
   * @param {number} [config.defaultIntervalMs=30000] Default polling interval in milliseconds
   * @param {number} [config.timeoutMs=5000] Default request timeout in milliseconds
   */
  constructor(config = {}) {
    super();
    this.config = config;
    // Architecture placeholder: components will be wired in future milestones
  }

  /**
   * Registers a new endpoint to monitor.
   * @param {Object} endpointConfig
   * @returns {EndpointChecker} Chaining reference
   */
  addEndpoint(endpointConfig) {
    // To be implemented in subsequent milestones
    return this;
  }

  /**
   * Starts periodic monitoring.
   */
  start() {
    // To be implemented in subsequent milestones
  }

  /**
   * Stops all active monitoring timers.
   */
  stop() {
    // To be implemented in subsequent milestones
  }

  /**
   * Retrieves overall aggregated health status.
   * @returns {Object}
   */
  getStatus() {
    // To be implemented in subsequent milestones
    return {};
  }

  /**
   * Retrieves current status for a specific endpoint.
   * @param {string} id Endpoint identifier
   * @returns {Object|null}
   */
  getEndpointStatus(id) {
    // To be implemented in subsequent milestones
    return null;
  }
}
