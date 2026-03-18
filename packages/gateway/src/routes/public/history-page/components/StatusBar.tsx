import type { StatsResponse } from "../types";

export function StatusBar({
  connected,
  stats,
  agentId,
}: {
  connected: boolean;
  stats: StatsResponse | null;
  agentId: string;
}) {
  const backUrl = `/agent/${encodeURIComponent(agentId)}`;

  return (
    <div class="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
      <div class="flex items-center gap-3">
        <a
          href={backUrl}
          class="text-gray-400 hover:text-gray-600 transition-colors"
          title="Back to settings"
          aria-label="Back to settings"
        >
          <svg
            aria-hidden="true"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span class="sr-only">Back to settings</span>
        </a>

        <div class="flex items-center gap-2">
          <span
            class={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-gray-300"}`}
          ></span>
          <span class="font-medium text-sm text-gray-700">Agent History</span>
        </div>

        {stats && (
          <div class="hidden sm:flex items-center gap-3 text-xs text-gray-400 ml-2">
            <span>{stats.messageCount} messages</span>
            {stats.currentModel && <span>{stats.currentModel}</span>}
            {(stats.totalInputTokens > 0 || stats.totalOutputTokens > 0) && (
              <span>
                {(
                  stats.totalInputTokens + stats.totalOutputTokens
                ).toLocaleString()}{" "}
                tokens
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
