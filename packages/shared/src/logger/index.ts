import winston from "winston";

export interface Logger {
  error: (message: any, ...args: any[]) => void;
  warn: (message: any, ...args: any[]) => void;
  info: (message: any, ...args: any[]) => void;
  debug: (message: any, ...args: any[]) => void;
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

  const logger = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      winston.format.splat()
    ),
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          ...(isProduction ? [] : [winston.format.colorize()]),
          winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
            let metaStr = "";
            if (Object.keys(meta).length) {
              try {
                metaStr = ` ${JSON.stringify(meta, null, 0)}`;
              } catch (_err) {
                // Handle circular structures by using a replacer function
                metaStr = ` ${JSON.stringify(meta, (_, value) => {
                  if (typeof value === "object" && value !== null) {
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
              }
            }
            return `[${timestamp}] [${level}] [${service}] ${message}${metaStr}`;
          })
        ),
      }),
    ],
  });

  return logger;
}

// Default logger instance for backward compatibility
export const logger = createLogger("shared");