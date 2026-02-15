/**
 * Simple Prometheus metrics exporter (no external dependencies)
 * Exposes basic gateway metrics in Prometheus text format
 */

import { createLogger } from "@lobu/core";

const logger = createLogger("metrics");

// Metric storage
interface MetricValue {
  value: number;
  labels: Record<string, string>;
}

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  values: MetricValue[];
}

const metrics: Map<string, Metric> = new Map();

// Initialize default metrics
function initializeMetrics() {
  // Worker deployment metrics
  registerMetric(
    "lobu_worker_deployments_total",
    "Total number of worker deployments created",
    "counter"
  );
  registerMetric(
    "lobu_worker_deployments_failed_total",
    "Total number of failed worker deployments",
    "counter"
  );
  registerMetric(
    "lobu_worker_deployments_active",
    "Current number of active worker deployments",
    "gauge"
  );

  // Message queue metrics
  registerMetric(
    "lobu_messages_received_total",
    "Total number of messages received",
    "counter"
  );
  registerMetric(
    "lobu_messages_processed_total",
    "Total number of messages processed",
    "counter"
  );
  registerMetric("lobu_queue_length", "Current message queue length", "gauge");

  // PVC metrics
  registerMetric(
    "lobu_pvc_created_total",
    "Total number of PVCs created",
    "counter"
  );
  registerMetric(
    "lobu_pvc_deleted_total",
    "Total number of PVCs deleted",
    "counter"
  );
  registerMetric(
    "lobu_pvc_cleanup_failed_total",
    "Total number of failed PVC cleanup operations",
    "counter"
  );

  // Redis metrics
  registerMetric(
    "lobu_redis_connection_errors_total",
    "Total number of Redis connection errors",
    "counter"
  );

  // HTTP proxy metrics
  registerMetric(
    "lobu_proxy_requests_total",
    "Total number of HTTP proxy requests",
    "counter"
  );
  registerMetric(
    "lobu_proxy_requests_blocked_total",
    "Total number of blocked proxy requests",
    "counter"
  );

  // Process metrics
  registerMetric(
    "lobu_process_start_time_seconds",
    "Start time of the process since unix epoch in seconds",
    "gauge"
  );

  // Set process start time
  setGauge("lobu_process_start_time_seconds", Math.floor(Date.now() / 1000));

  logger.info("✅ Prometheus metrics initialized");
}

function registerMetric(
  name: string,
  help: string,
  type: "counter" | "gauge" | "histogram"
) {
  metrics.set(name, { name, help, type, values: [] });
}

/**
 * Set a gauge metric value (internal use only)
 */
function setGauge(
  name: string,
  value: number,
  labels: Record<string, string> = {}
) {
  const metric = metrics.get(name);
  if (!metric || metric.type !== "gauge") {
    logger.warn(`Gauge metric ${name} not found`);
    return;
  }

  const labelKey = JSON.stringify(labels);
  const existing = metric.values.find(
    (v) => JSON.stringify(v.labels) === labelKey
  );
  if (existing) {
    existing.value = value;
  } else {
    metric.values.push({ value, labels });
  }
}

/**
 * Get metrics in Prometheus text format
 */
export function getMetricsText(): string {
  const lines: string[] = [];

  for (const metric of metrics.values()) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    if (metric.values.length === 0) {
      // Output default value for metrics with no data
      lines.push(`${metric.name} 0`);
    } else {
      for (const { value, labels } of metric.values) {
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        if (labelStr) {
          lines.push(`${metric.name}{${labelStr}} ${value}`);
        } else {
          lines.push(`${metric.name} ${value}`);
        }
      }
    }
  }

  // Add Node.js process metrics
  const memUsage = process.memoryUsage();
  lines.push(`# HELP nodejs_heap_size_bytes Node.js heap size in bytes`);
  lines.push(`# TYPE nodejs_heap_size_bytes gauge`);
  lines.push(`nodejs_heap_size_bytes{type="used"} ${memUsage.heapUsed}`);
  lines.push(`nodejs_heap_size_bytes{type="total"} ${memUsage.heapTotal}`);

  lines.push(
    `# HELP nodejs_external_memory_bytes Node.js external memory in bytes`
  );
  lines.push(`# TYPE nodejs_external_memory_bytes gauge`);
  lines.push(`nodejs_external_memory_bytes ${memUsage.external}`);

  return `${lines.join("\n")}\n`;
}

// Initialize on module load
initializeMetrics();
