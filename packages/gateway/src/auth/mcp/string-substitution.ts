import { createLogger } from "@lobu/core";
import type { InputValues } from "./input-store";

const logger = createLogger("string-substitution");

/**
 * Substitutes placeholders in a string with values from environment or inputs
 *
 * Supported formats:
 * - ${env:VAR_NAME} - Replaced with process.env.VAR_NAME
 * - ${input:INPUT_ID} - Replaced with stored input values
 *
 * @example
 * substitute("Bearer ${env:API_KEY}", {}) // "Bearer abc123"
 * substitute("Bearer ${input:pat}", { pat: "ghp_xyz" }) // "Bearer ghp_xyz"
 */
export function substituteString(
  template: string,
  inputs: InputValues = {}
): string {
  return template.replace(/\$\{(env|input):([^}]+)\}/g, (match, type, key) => {
    if (type === "env") {
      const value = process.env[key];
      if (!value) {
        logger.warn(`Environment variable not found: ${key}`);
        return match; // Keep original if not found
      }
      return value;
    }

    if (type === "input") {
      const value = inputs[key];
      if (!value) {
        logger.warn(`Input value not found: ${key}`);
        return match; // Keep original if not found
      }
      return value;
    }

    return match;
  });
}

/**
 * Substitutes placeholders in an object's values recursively
 */
export function substituteObject<T extends Record<string, any>>(
  obj: T,
  inputs: InputValues = {}
): T {
  const result: any = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = substituteString(value, inputs);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string" ? substituteString(item, inputs) : item
      );
    } else if (value && typeof value === "object") {
      result[key] = substituteObject(value, inputs);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
