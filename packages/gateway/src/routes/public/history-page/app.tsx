import { useSignal } from "@preact/signals";
import { useVirtualizer } from "@tanstack/react-virtual";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { MessageRow } from "./components/MessageRow";
import { StatusBar } from "./components/StatusBar";
import { WakePrompt } from "./components/WakePrompt";
import type {
  HistoryMessage,
  MessagesResponse,
  StatsResponse,
  StatusResponse,
} from "./types";

declare global {
  interface Window {
    __AGENT_ID__: string;
    __sessionReady__?: Promise<void>;
  }
}

function App() {
  const agentId = window.__AGENT_ID__;
  const messages = useSignal<HistoryMessage[]>([]);
  const loading = useSignal(false);
  const hasMore = useSignal(true);
  const cursor = useSignal<string | null>(null);
  const status = useSignal<StatusResponse | null>(null);
  const stats = useSignal<StatsResponse | null>(null);
  const focusedId = useSignal<string | null>(null);
  const initialLoad = useSignal(true);
  const error = useSignal<string | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  // Parse URL state
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("msg")) focusedId.value = params.get("msg");
  }, []);

  // Fetch status
  async function fetchStatus() {
    try {
      const resp = await fetch(`/api/v1/agents/${agentId}/history/status`);
      if (resp.ok) {
        status.value = await resp.json();
      }
    } catch {
      status.value = {
        connected: false,
        hasHttpServer: false,
        deploymentCount: 0,
      };
    }
  }

  // Fetch stats
  async function fetchStats() {
    try {
      const resp = await fetch(
        `/api/v1/agents/${agentId}/history/session/stats`
      );
      if (resp.ok) {
        stats.value = await resp.json();
      }
    } catch {
      // ignore
    }
  }

  // Fetch messages
  async function fetchMessages(cursorParam?: string | null) {
    if (loading.value) return;
    loading.value = true;
    error.value = null;

    try {
      const params = new URLSearchParams();
      if (cursorParam) params.set("cursor", cursorParam);
      params.set("limit", "100");

      const resp = await fetch(
        `/api/v1/agents/${agentId}/history/session/messages?${params}`
      );

      if (!resp.ok) {
        if (resp.status === 503) {
          status.value = {
            connected: false,
            hasHttpServer: false,
            deploymentCount: 0,
          };
          return;
        }
        throw new Error(`HTTP ${resp.status}`);
      }

      const data: MessagesResponse = await resp.json();

      if (cursorParam) {
        messages.value = [...messages.value, ...data.messages];
      } else {
        messages.value = data.messages;
      }

      cursor.value = data.nextCursor;
      hasMore.value = data.hasMore;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load messages";
    } finally {
      loading.value = false;
      initialLoad.value = false;
    }
  }

  // Initial load — wait for session bootstrap (token→cookie exchange) first
  useEffect(() => {
    const init = async () => {
      if (window.__sessionReady__) await window.__sessionReady__;
      await fetchStatus();
      if (status.value?.connected) {
        fetchMessages();
        fetchStats();
      } else {
        initialLoad.value = false;
      }
    };
    init();
  }, []);

  // Virtual scroll
  const virtualizer = useVirtualizer({
    count: messages.value.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  // Load more when reaching the end
  useEffect(() => {
    const items = virtualizer.getVirtualItems();
    const lastItem = items[items.length - 1];
    if (!lastItem) return;

    if (
      lastItem.index >= messages.value.length - 5 &&
      hasMore.value &&
      !loading.value &&
      cursor.value
    ) {
      fetchMessages(cursor.value);
    }
  }, [virtualizer.getVirtualItems(), hasMore.value, loading.value]);

  // Scroll to focused message
  useEffect(() => {
    if (focusedId.value && messages.value.length > 0) {
      const idx = messages.value.findIndex((m) => m.id === focusedId.value);
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: "center" });
      }
    }
  }, [focusedId.value, messages.value.length]);

  // Handle wake callback
  function onWake() {
    fetchStatus().then(() => {
      if (status.value?.connected) {
        fetchMessages();
        fetchStats();
      }
    });
  }

  if (initialLoad.value) {
    return (
      <div class="flex items-center justify-center flex-1">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!status.value?.connected) {
    return (
      <>
        <StatusBar connected={false} stats={stats.value} agentId={agentId} />
        <WakePrompt agentId={agentId} onWake={onWake} />
      </>
    );
  }

  return (
    <>
      <StatusBar connected={true} stats={stats.value} agentId={agentId} />

      {error.value && (
        <div class="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error.value}
        </div>
      )}

      <div ref={parentRef} class="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const msg = messages.value[virtualRow.index];
            if (!msg) return null;
            return (
              <div
                key={msg.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <MessageRow
                  message={msg}
                  isFocused={msg.id === focusedId.value}
                />
              </div>
            );
          })}
        </div>

        {loading.value && (
          <div class="flex justify-center py-4">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
        )}

        {!hasMore.value && messages.value.length > 0 && (
          <div class="text-center py-4 text-gray-400 text-sm">
            End of conversation
          </div>
        )}

        {!loading.value && messages.value.length === 0 && (
          <div class="text-center py-12 text-gray-400">No messages yet</div>
        )}
      </div>
    </>
  );
}

render(<App />, document.getElementById("app")!);
