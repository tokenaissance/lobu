/**
 * Sanitize filename to prevent path traversal attacks
 * Removes directory separators and dangerous characters
 *
 * @param filename - The filename to sanitize
 * @param maxLength - Maximum filename length (default: 255)
 * @returns Safe filename
 *
 * @example
 * ```typescript
 * sanitizeFilename("../../etc/passwd") // "etc_passwd"
 * sanitizeFilename("file<>|name.txt") // "file___name.txt"
 * ```
 */
export function sanitizeFilename(
  filename: string,
  maxLength: number = 255
): string {
  // Remove any directory path components
  const basename = filename.replace(/^.*[\\/]/, "");

  // Remove null bytes and other dangerous characters
  const sanitized = basename.replace(/[^\w\s.-]/g, "_");

  // Prevent hidden files and parent directory references
  const safe = sanitized.replace(/^\.+/, "").replace(/\.{2,}/g, ".");

  if (!safe) {
    return "unnamed_file";
  }

  return safe.length > maxLength ? safe.substring(0, maxLength) : safe;
}

/**
 * Sanitize conversation ID for filesystem usage
 * Removes any characters that aren't safe for directory names
 *
 * @param conversationId - The conversation ID to sanitize
 * @returns Safe conversation ID
 *
 * @example
 * ```typescript
 * sanitizeConversationId("1756766056.836119") // "1756766056.836119"
 * sanitizeConversationId("thread/123/../456") // "thread_123___456"
 * ```
 */
export function sanitizeConversationId(conversationId: string): string {
  return conversationId.replace(/[^a-zA-Z0-9.-]/g, "_");
}

/**
 * Sanitize sensitive data from objects before logging
 * Redacts API keys, tokens, and other credentials
 *
 * @param obj - Object to sanitize
 * @param sensitiveKeys - Additional sensitive key names to redact
 * @returns Sanitized object safe for logging
 *
 * @example
 * ```typescript
 * const config = {
 *   apiKey: "secret-key-123",
 *   timeout: 5000,
 *   env: { TOKEN: "bearer-xyz" }
 * };
 *
 * sanitizeForLogging(config)
 * // {
 * //   apiKey: "[REDACTED:14]",
 * //   timeout: 5000,
 * //   env: { TOKEN: "[REDACTED:10]" }
 * // }
 * ```
 */
export function sanitizeForLogging(
  obj: any,
  additionalSensitiveKeys: string[] = []
): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const defaultSensitiveKeys = [
    "anthropic_api_key",
    "api_key",
    "apikey",
    "token",
    "password",
    "secret",
    "authorization",
    "bearer",
    "credentials",
    "privatekey",
    "private_key",
  ];

  const sensitiveKeys = [
    ...defaultSensitiveKeys,
    ...additionalSensitiveKeys.map((k) => k.toLowerCase()),
  ];

  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key in sanitized) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some((k) => lowerKey.includes(k));

    if (isSensitive && typeof sanitized[key] === "string") {
      sanitized[key] = `[REDACTED:${sanitized[key].length}]`;
    } else if (typeof sanitized[key] === "object") {
      sanitized[key] = sanitizeForLogging(
        sanitized[key],
        additionalSensitiveKeys
      );
    }
  }

  return sanitized;
}
