const processStartTimeSeconds = Math.floor(Date.now() / 1000);

export function getMetricsText(): string {
  const lines: string[] = [];

  lines.push(
    "# HELP lobu_process_start_time_seconds Start time of the process since unix epoch in seconds"
  );
  lines.push("# TYPE lobu_process_start_time_seconds gauge");
  lines.push(`lobu_process_start_time_seconds ${processStartTimeSeconds}`);

  const memUsage = process.memoryUsage();
  lines.push("# HELP nodejs_heap_size_bytes Node.js heap size in bytes");
  lines.push("# TYPE nodejs_heap_size_bytes gauge");
  lines.push(`nodejs_heap_size_bytes{type="used"} ${memUsage.heapUsed}`);
  lines.push(`nodejs_heap_size_bytes{type="total"} ${memUsage.heapTotal}`);

  lines.push(
    "# HELP nodejs_external_memory_bytes Node.js external memory in bytes"
  );
  lines.push("# TYPE nodejs_external_memory_bytes gauge");
  lines.push(`nodejs_external_memory_bytes ${memUsage.external}`);

  return `${lines.join("\n")}\n`;
}
