# Endpoint Health Checker

> A lightweight, zero-dependency Node.js library for periodic API monitoring, latency tracking, and failure detection.

---

## Overview

**Endpoint Health Checker** is an in-process monitoring utility designed for Node.js backends. Instead of relying exclusively on external synthetic monitoring services or running separate infrastructure, this package runs alongside your application to periodically probe target endpoints, track response times, detect outages, and emit health status updates.

> **Status:** Early development (Design & Architecture Phase). This project is in its initial setup stage and is not yet published.

---

## Problem Statement

Modern backend services often depend on multiple external or internal APIs (payment processors, authentication providers, microservices, databases with HTTP interfaces). When one of these upstream dependencies experiences degradation or downtime:

1. **Silent Failures:** The host application often discovers the failure only when an end-user triggers a request that fails.
2. **Heavy External Tooling:** Setting up full-featured APM tools (e.g., Datadog, New Relic) or external uptime monitors can be overkill or cost-prohibitive for small services, MVPs, and internal tools.
3. **Private Network Blindspots:** External uptime checkers cannot probe services sitting inside a private VPC or local network without custom tunnels or public access points.

---

## Why This Package Is Useful

* **Runs from the application's perspective:** Validates connectivity and latency from the exact environment where your application runs, catching network partitions and DNS issues specific to your host.
* **Proactive failure notification:** Detects failing dependencies before users report broken workflows.
* **Low friction:** Designed to be configured directly in code with minimal setup overhead.
* **Event-driven:** Easily integrates with custom logging, metrics collectors, or webhook notifications via standard Node.js events.

---

## Target Users

* **Node.js Backend Developers:** Engineers building services that consume third-party or internal APIs.
* **Microservices Teams:** Teams needing internal health checks across services residing in private networks.
* **Indie Developers & Students:** Anyone building backend projects that require dependable health monitoring without incurring infrastructure or SaaS costs.

---

## Planned MVP Features

* **Configurable Endpoint Probing:**
  * Define endpoints by URL, HTTP method (GET, HEAD, POST), custom headers, and request timeouts.
  * Configurable polling intervals per endpoint or globally.
* **Success & Health Criteria:**
  * Configurable expected HTTP status codes (e.g., `200`, ranges like `200-299`).
  * Response time threshold checks (flagging slow responses as degraded).
* **Metrics & Diagnostics:**
  * Round-trip latency measurement (in milliseconds).
  * Current status tracking (`UP`, `DOWN`, `DEGRADED`).
  * Consecutive failure count and error messaging.
* **Lifecycle Events:**
  * Event emitter emitting `check`, `up`, `down`, `degraded`, and `error` events for custom handling.
* **Clean Control Flow:**
  * Explicit `start()` and `stop()` methods to safely manage poller timers without leaking resources.

---

## How It Works

```
+-------------------------------------------------------------+
|                 Your Node.js Application                    |
|                                                             |
|  +-------------------------------------------------------+  |
|  |             Endpoint Health Checker                   |  |
|  |                                                       |  |
|  |  +------------------+         +--------------------+  |  |
|  |  | Periodic Poller  | ------> | HTTP/S Prober      |  |  |
|  |  +------------------+         +---------+----------+  |  |
|  |                                         |             |  |
|  +-----------------------------------------|-------------+  |
|                                            |                |
|                                            v                |
|                              HTTP/HTTPS Requests            |
+--------------------------------------------|----------------+
                                             |
                   +-------------------------+-------------------------+
                   |                         |                         |
                   v                         v                         v
           [ Auth Provider ]        [ Payment Gateway ]       [ Microservice B ]
```

1. **Configuration:** You register target endpoints with custom schedules and expectations.
2. **Scheduling:** The checker schedules periodic tasks using Node.js timers.
3. **Probing:** On each tick, the prober sends an HTTP/HTTPS request, measures the round-trip latency, and captures the response status or connection error.
4. **Evaluation:** The result is compared against defined success criteria (status code range and maximum allowed latency).
5. **Reporting & Events:** Status updates and metrics are stored in memory and broadcasted via an event emitter for consumer handling.

---

## Planned Usage Example

> **Note:** The following code is an illustrative design preview of the planned API. It is not currently executable.

```javascript
// Planned API Preview (Not yet implemented)
import { EndpointChecker } from './src/index.js';

const checker = new EndpointChecker({
  defaultIntervalMs: 30000, // Check every 30 seconds
  timeoutMs: 5000,          // 5-second request timeout
});

// Register endpoints to monitor
checker.addEndpoint({
  id: 'payment-gateway',
  name: 'Payment Service API',
  url: 'https://api.paymentservice.example.com/health',
  method: 'GET',
  expectedStatus: 200,
  maxAcceptableLatencyMs: 800,
});

checker.addEndpoint({
  id: 'auth-service',
  name: 'Authentication API',
  url: 'https://auth.internal.local/v1/ping',
  intervalMs: 15000, // Override with a custom interval
});

// Listen to lifecycle events
checker.on('down', (report) => {
  console.error(`[ALERT] ${report.name} is DOWN! Error: ${report.error}`);
});

checker.on('degraded', (report) => {
  console.warn(`[WARN] ${report.name} is SLOW! Latency: ${report.latencyMs}ms`);
});

checker.on('up', (report) => {
  console.log(`[OK] ${report.name} is healthy (${report.latencyMs}ms)`);
});

// Start monitoring
checker.start();

// Gracefully stop on shutdown
process.on('SIGTERM', () => {
  checker.stop();
});
```

---

## Planned Technology Stack

* **Runtime:** Node.js (`>= 18.0.0`)
* **HTTP Client:** Native Node.js `fetch` or native `node:http` / `node:https` (keeping dependencies minimal or zero)
* **Event Dispatch:** Built-in Node.js `node:events` (`EventEmitter`)
* **Testing:** Node.js built-in test runner (`node:test`) or Jest / Vitest
* **Language / Format:** Modern JavaScript (ES Modules) or TypeScript

---

## Project Roadmap

* [x] **Phase 1: Concept & Documentation**
  * Define scope, problem statement, and API design in `README.md`.
* [ ] **Phase 2: Project Setup & Environment**
  * Initialize `package.json` with ESM configuration, scripts, and initial tooling.
* [ ] **Phase 3: Core Prober Implementation**
  * Implement HTTP request dispatcher with timeout handling and latency timing.
* [ ] **Phase 4: Scheduling & Health Evaluation Engine**
  * Implement periodic polling engine, status computation (`UP`, `DOWN`, `DEGRADED`), and event emission.
* [ ] **Phase 5: Automated Testing**
  * Unit and integration test suite mocking successful responses, timeouts, and HTTP errors.
* [ ] **Phase 6: Packaging & Documentation Polish**
  * Finalize API references, licensing, and package metadata.

---

## Contribution Guidelines

Contributions, suggestions, and issue reports are welcome as the project develops.

1. Fork or clone the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`.
3. Commit your changes with clear, descriptive messages.
4. Ensure all tests and lint checks pass once tooling is established.
5. Open a Pull Request describing your changes.

---

## License

This project is planned to be licensed under the [MIT License](LICENSE).
