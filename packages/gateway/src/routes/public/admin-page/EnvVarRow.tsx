import { useSignal } from "@preact/signals";
import type { EnvVarEntry } from "../settings-page/api";
import * as api from "../settings-page/api";

export function EnvVarRow({
  entry,
  onRefresh,
}: {
  entry: EnvVarEntry;
  onRefresh: () => void;
}) {
  const expanded = useSignal(false);
  const inputValue = useSignal("");
  const saving = useSignal(false);
  const error = useSignal("");

  const handleSave = async () => {
    if (!inputValue.value.trim()) return;
    saving.value = true;
    error.value = "";
    try {
      await api.setEnvVar(entry.key, inputValue.value.trim());
      inputValue.value = "";
      expanded.value = false;
      onRefresh();
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Failed to save";
    } finally {
      saving.value = false;
    }
  };

  const handleClear = async () => {
    saving.value = true;
    error.value = "";
    try {
      await api.deleteEnvVar(entry.key);
      expanded.value = false;
      onRefresh();
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Failed to clear";
    } finally {
      saving.value = false;
    }
  };

  return (
    <div class="border-b border-gray-100 last:border-b-0">
      <button
        type="button"
        class="flex w-full items-center justify-between py-1.5 px-2 cursor-pointer hover:bg-gray-50 bg-transparent border-0"
        onClick={() => {
          expanded.value = !expanded.value;
        }}
      >
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-700 font-mono">{entry.key}</span>
          <span
            class={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
              entry.isSet
                ? "bg-emerald-100 text-emerald-800"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {entry.isSet ? "Set" : "Not set"}
          </span>
        </div>
        {entry.maskedValue && (
          <span class="text-[10px] text-gray-400 font-mono">
            {entry.maskedValue}
          </span>
        )}
      </button>
      {expanded.value && (
        <div class="px-2 pb-2 pt-1">
          <div class="flex gap-1.5">
            <input
              type="password"
              class="flex-1 text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="Enter new value..."
              value={inputValue.value}
              onInput={(e) => {
                inputValue.value = (e.target as HTMLInputElement).value;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            <button
              type="button"
              class="text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={saving.value || !inputValue.value.trim()}
              onClick={handleSave}
            >
              Save
            </button>
            {entry.isSet && (
              <button
                type="button"
                class="text-[10px] px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                disabled={saving.value}
                onClick={handleClear}
              >
                Clear
              </button>
            )}
          </div>
          {error.value && (
            <p class="text-[10px] text-red-600 mt-1">{error.value}</p>
          )}
        </div>
      )}
    </div>
  );
}
