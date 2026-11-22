/**
 * EndpointChecker interface wrapper.
 * Re-exports EndpointMonitor from monitor.js for seamless backwards compatibility.
 */

import { EndpointMonitor, EndpointChecker } from './monitor.js';

export { EndpointMonitor, EndpointChecker };
export default EndpointChecker;
