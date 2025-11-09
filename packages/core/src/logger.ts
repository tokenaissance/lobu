import winston from "winston";
import { getSentry } from "./sentry";

export interface Logger {
  error: (message: any, ...args: any[]) => void;
  warn: (message: any, ...args: any[]) => void;
  info: (message: any, ...args: any[]) => void;
  debug: (message: any, ...args: any[]) => void;
}

/**
 * Custom Winston transport that sends errors to Sentry
 */
class SentryTransport extends winston.transports.Stream {
  constructor() {
    super({ stream: process.stdout });
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit("logged", info);
    });

    // Only send errors and warnings to Sentry
    if (info.level === "error" || info.level === "warn") {
      const Sentry = getSentry();
      if (Sentry) {
        try {
          // Extract error object if present
          const errorObj =
            info.error || (info.message instanceof Error ? info.message : null);

          if (errorObj instanceof Error) {
            Sentry.captureException(errorObj, {
              level: info.level === "error" ? "error" : "warning",
              tags: {
                service: info.service,
              },
              extra: {
                ...info,
                message: info.message,
              },
            });
          } else {
            // Send as message if no Error object
            Sentry.captureMessage(String(info.message), {
              level: info.level === "error" ? "error" : "warning",
              tags: {
                service: info.service,
              },
              extra: info,
            });
          }
        } catch (_err) {
          // Ignore Sentry errors to avoid breaking logging
        }
      }
    }

    callback();
  }
}

/**
 * Creates a logger instance for a specific service
 * Provides consistent logging format across all packages with level and timestamp
 * @param serviceName The name of the service using the logger
 * @returns A winston logger instance
 */
export function createLogger(serviceName: string): Logger {
  const isProduction = process.env.NODE_ENV === "production";
  const level = process.env.LOG_LEVEL || "info";

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        ...(isProduction ? [] : [winston.format.colorize()]),
        winston.format.printf(
          ({ timestamp, level, message, service, ...meta }) => {
            let metaStr = "";
            if (Object.keys(meta).length) {
              try {
                metaStr = ` ${JSON.stringify(meta, null, 0)}`;
              } catch (_err) {
                // Handle circular structures with a safer approach
                try {
                  const seen = new WeakSet();
                  metaStr = ` ${JSON.stringify(meta, (_key, value) => {
                    if (typeof value === "object" && value !== null) {
                      if (seen.has(value)) {
                        return "[Circular Reference]";
                      }
                      seen.add(value);

                      if (value instanceof Error) {
                        return {
                          name: value.name,
                          message: value.message,
                          stack: value.stack?.split("\n")[0], // Only first line of stack
                        };
                      }
                    }
                    return value;
                  })}`;
                } catch (_err2) {
                  // Final fallback if even the circular handler fails
                  metaStr = " [Object too complex to serialize]";
                }
              }
            }
            return `[${timestamp}] [${level}] [${service}] ${message}${metaStr}`;
          }
        )
      ),
    }),
  ];

  // Add Sentry transport in production or if SENTRY_DSN is set
  if (isProduction || process.env.SENTRY_DSN) {
    transports.push(new SentryTransport());
  }

  const logger = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      winston.format.splat()
    ),
    defaultMeta: { service: serviceName },
    transports,
  });

  return logger;
}

// Default logger instance for backward compatibility
export const logger = createLogger("shared");
