/**
 * Shared interaction utilities for platform interaction renderers.
 */

import type { FieldSchema } from "@termosdev/core";

export type InteractionDisplayType = "radio" | "single-form" | "multi-section";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};

export const APPROVAL_OPTIONS = ["Yes", "No"] as const;

/**
 * Determine interaction type from options format.
 */
export function getInteractionType(options: unknown): InteractionDisplayType {
  if (Array.isArray(options)) {
    if (options.length === 0) return "radio";

    const firstItem = options[0];
    if (
      typeof firstItem === "object" &&
      firstItem !== null &&
      "label" in firstItem &&
      "fields" in firstItem
    ) {
      return options.length === 1 ? "single-form" : "multi-section";
    }
    return "radio";
  }

  if (options && typeof options === "object") {
    const firstValue = Object.values(options)[0];
    if (firstValue && typeof firstValue === "object" && "type" in firstValue) {
      return "single-form";
    }
    return "multi-section";
  }

  return "radio";
}

export function isApprovalInteraction(interactionType: string): boolean {
  return (
    interactionType === "tool_approval" || interactionType === "plan_approval"
  );
}

export function formatNumberedOptions(
  question: string,
  options: string[]
): string {
  const list = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
  return `${question}\n\n${list}\n\nReply with the number of your choice.`;
}

export function parseOptionResponse(
  response: string,
  options: string[]
): string | null {
  const trimmed = response.trim().toLowerCase();

  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
    return options[num - 1] ?? null;
  }

  const wordNum = NUMBER_WORDS[trimmed];
  if (wordNum && wordNum >= 1 && wordNum <= options.length) {
    return options[wordNum - 1] ?? null;
  }

  return options.find((opt) => opt.toLowerCase() === trimmed) ?? null;
}

export function getFieldLabel(fieldName: string, field: FieldSchema): string {
  return field.label || fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}
