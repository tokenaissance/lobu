import { createLogger } from "@termosdev/core";

const logger = createLogger("socket-health-monitor");

interface SocketHealthConfig {
  /** How often to check for zombie connection (ms) */
  checkIntervalMs: number;
  /** Consider connection stale if no events for this long (ms) */
  staleThresholdMs: number;
  /** Protect active workers from restart */
  protectActiveWorkers: boolean;
}

/**
 * Socket Health Monitor
 *
 * Detects zombie Socket Mode connections by monitoring Socket Mode event activity.
 * Socket Mode emits internal events (heartbeats, keepalives) every ~30-60 seconds
 * even in quiet workspaces. If no events are received for the threshold period,
 * the connection is considered stale/zombie and triggers a process exit for restart.
 */
export class SocketHealthMonitor {
  private config: SocketHealthConfig;
  private lastEventTimestamp: number;
  private healthCheckInterval?: NodeJS.Timeout;
  private isRunning = false;
  private getActiveWorkerCountFn?: () => number;

  constructor(config: SocketHealthConfig) {
    this.config = config;
    this.lastEventTimestamp = Date.now();
  }

  /**
   * Start health monitoring
   */
  start(getActiveWorkerCount: () => number): void {
    if (this.isRunning) {
      logger.warn("Health monitor already running");
      return;
    }

    this.getActiveWorkerCountFn = getActiveWorkerCount;
    this.isRunning = true;
    this.lastEventTimestamp = Date.now(); // Reset on start

    logger.info("Socket health monitor started", {
      checkIntervalMs: this.config.checkIntervalMs,
      staleThresholdMs: this.config.staleThresholdMs,
      protectActiveWorkers: this.config.protectActiveWorkers,
    });

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    this.isRunning = false;
    logger.info("Socket health monitor stopped");
  }

  /**
   * Record that a Socket Mode event was received
   * Call this on EVERY Socket Mode event (not just messages)
   */
  recordSocketEvent(): void {
    this.lastEventTimestamp = Date.now();
  }

  /**
   * Perform health check - detect zombie connection
   */
  private performHealthCheck(): void {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();
    const timeSinceLastEvent = now - this.lastEventTimestamp;
    const activeWorkers = this.getActiveWorkerCountFn?.() || 0;

    // Check if connection is stale
    if (timeSinceLastEvent > this.config.staleThresholdMs) {
      logger.warn("🚨 Zombie Socket Mode connection detected!", {
        timeSinceLastEvent,
        staleThresholdMs: this.config.staleThresholdMs,
        activeWorkers,
      });

      // Check if we should protect active workers
      if (this.config.protectActiveWorkers && activeWorkers > 0) {
        logger.info(
          `Delaying restart to protect ${activeWorkers} active worker(s)`
        );
        return;
      }

      // Trigger restart by exiting process
      logger.error(
        "Socket Mode connection is stale - exiting for container restart"
      );
      logger.error(
        "Docker/Kubernetes will automatically restart the gateway container"
      );

      // Exit with code 0 to indicate intentional restart (not a failure)
      process.exit(0);
    }

    // Log health status periodically for monitoring
    if (timeSinceLastEvent > this.config.staleThresholdMs * 0.5) {
      logger.info("Socket connection health check", {
        timeSinceLastEvent,
        thresholdMs: this.config.staleThresholdMs,
        status: "degraded",
      });
    }
  }

  /**
   * Get current health status for monitoring/debugging
   */
  getStatus(): {
    isRunning: boolean;
    timeSinceLastEvent: number;
    isStale: boolean;
  } {
    const timeSinceLastEvent = Date.now() - this.lastEventTimestamp;
    return {
      isRunning: this.isRunning,
      timeSinceLastEvent,
      isStale: timeSinceLastEvent > this.config.staleThresholdMs,
    };
  }
}
