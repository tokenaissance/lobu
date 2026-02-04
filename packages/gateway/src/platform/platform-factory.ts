/**
 * Platform factory for declarative platform registration.
 * Replaces conditional platform creation in gateway startup.
 */

import { createLogger } from "@termosdev/core";
import type { PlatformAdapter } from "../platform";

const logger = createLogger("platform-factory");

/**
 * Factory interface for creating platform adapters.
 */
export interface PlatformFactory {
  /**
   * Platform name (e.g., "slack", "whatsapp")
   */
  readonly name: string;

  /**
   * Check if platform is enabled based on configuration.
   */
  isEnabled(config: PlatformConfigs): boolean;

  /**
   * Create platform adapter instance.
   */
  create(
    config: PlatformConfigs,
    agentOptions: AgentOptions,
    sessionTimeoutMinutes: number
  ): PlatformAdapter;
}

/**
 * Agent options passed to platforms.
 */
export interface AgentOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  timeoutMinutes?: number;
}

/**
 * Combined platform configurations.
 */
export interface PlatformConfigs {
  slack?: any;
  whatsapp?: any;
  [key: string]: any;
}

/**
 * Registry of platform factories.
 * Platforms register themselves on module load.
 */
class PlatformFactoryRegistry {
  private factories = new Map<string, PlatformFactory>();

  /**
   * Register a platform factory.
   */
  register(factory: PlatformFactory): void {
    this.factories.set(factory.name, factory);
    logger.info(`Registered platform factory: ${factory.name}`);
  }

  /**
   * Get all registered factories.
   */
  getAll(): PlatformFactory[] {
    return Array.from(this.factories.values());
  }

  /**
   * Get factory by name.
   */
  get(name: string): PlatformFactory | undefined {
    return this.factories.get(name);
  }

  /**
   * Create all enabled platforms.
   */
  createEnabledPlatforms(
    configs: PlatformConfigs,
    agentOptions: AgentOptions,
    sessionTimeoutMinutes: number
  ): PlatformAdapter[] {
    const platforms: PlatformAdapter[] = [];

    for (const factory of this.factories.values()) {
      if (factory.isEnabled(configs)) {
        logger.info(`Creating platform: ${factory.name}`);
        const platform = factory.create(
          configs,
          agentOptions,
          sessionTimeoutMinutes
        );
        platforms.push(platform);
      } else {
        logger.info(`Platform ${factory.name} is disabled, skipping`);
      }
    }

    return platforms;
  }
}

/**
 * Global platform factory registry.
 */
export const platformFactoryRegistry = new PlatformFactoryRegistry();
