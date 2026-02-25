/**
 * Shared interaction utilities for platform interaction renderers.
 */

export const APPROVAL_OPTIONS = ["Yes", "No"] as const;

export function formatNumberedOptions(
  question: string,
  options: string[]
): string {
  const list = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
  return `${question}\n\n${list}\n\nReply with the number of your choice.`;
}
