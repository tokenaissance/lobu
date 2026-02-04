import type { Server } from "node:http";
import { createLogger } from "@termosdev/core";
import { startHttpProxy, stopHttpProxy } from "./http-proxy";

const logger = createLogger("proxy-manager");

let proxyServer: Server | null = null;

/**
 * Start filtering HTTP proxy for worker network isolation
 * Workers can only access internet via this proxy, which enforces domain allowlist/blocklist
 *
 * Behavior based on environment configuration:
 * - Empty/unset: Deny all (complete isolation)
 * - WORKER_ALLOWED_DOMAINS=*: Allow all (unrestricted)
 * - WORKER_ALLOWED_DOMAINS=domains: Allowlist mode
 * - WORKER_DISALLOWED_DOMAINS=domains: Blocklist mode
 * - Both set: Allowlist with exceptions
 */
export async function startFilteringProxy(): Promise<void> {
  try {
    // Start our custom HTTP proxy (no GPL dependencies!)
    proxyServer = startHttpProxy(8118);

    // Wait a bit for proxy to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    logger.info("✅ HTTP proxy started successfully on port 8118");
  } catch (error) {
    logger.error("Failed to start HTTP proxy:", error);
    throw error;
  }
}

/**
 * Stop filtering proxy (cleanup on shutdown)
 */
export async function stopFilteringProxy(): Promise<void> {
  if (proxyServer) {
    logger.info("Stopping HTTP proxy...");
    await stopHttpProxy(proxyServer);
    proxyServer = null;
  }
}

/**
 * Handle graceful shutdown
 */
process.on("SIGTERM", async () => {
  await stopFilteringProxy();
});

process.on("SIGINT", async () => {
  await stopFilteringProxy();
});
