#!/usr/bin/env bun

/**
 * Main entry point for Lobu Gateway
 * Exports types and utilities for other packages (like @lobu/slack)
 */

// Export types and classes for external packages
export type { GatewayConfig } from "./config";
export { RedisSessionStore, SessionManager } from "./services/session-manager";

// Start CLI when run directly
import("./cli");
