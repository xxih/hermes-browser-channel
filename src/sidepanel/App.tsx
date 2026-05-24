import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BgToSidepanel, ConnectionState, SidepanelToBg } from "@/lib/messages";
import type { ContextOptions } from "@/lib/protocol";
import {
  type ChatMessage,
  type Settings,
  clearHistory,
  loadHistory,
  loadSettings,
  saveHistory,
} from "@/lib/storage";
import { uuid } from "@/lib/id";
import { Composer } from "./components/Composer";
import { ConnectionBar } from "./components/ConnectionBar";
import { MessageBubble } from "./components/MessageBubble";
import { ToolRow } from "./components/ToolRow";

const SUBSCRIBE: SidepanelToBg = { kind: "subscribe" };

export function App() {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [conn, setConn] = useState<{ state: ConnectionState; detail?: string }>({ state: "idle" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [contextOptions, setContextOptions] = useState<ContextOptions>({
    url_title: true,
    selection: true,
    page: false,
    screenshot: false,
  });
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  historyRef.current = history;

  const persist = useCallback((h: ChatMessage[]) => {
    void saveHistory(h);
  }, []);

  const upsert = useCallback(
    (updater: (h: ChatMessage[]) => ChatMessage[]) => {
      setHistory((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  useEffect(() => {
    void loadHistory().then(setHistory);
    void loadSettings().then((s) => {
      setSettings(s);
      setContextOptions(s.default_context);
    });
  }, []);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "sidepanel" });
    portRef.current = port;
    port.postMessage(SUBSCRIBE);

    port.onMessage.addListener((msg: BgToSidepanel) => {
      if (msg.kind === "connection") {
        setConn({ state: msg.state, detail: msg.detail });
        return;
      }
      if (msg.kind === "server_event") {
        const ev = msg.event;
        if (ev.type === "welcome") {
          if (ev.greeting) {
            upsert((h) => [
              ...h,
              { id: uuid(), role: "system", text: ev.greeting!, ts: Date.now(), level: "info" },
            ]);
          }
          return;
        }
        if (ev.type === "system") {
          upsert((h) => [
            ...h,
            { id: uuid(), role: "system", text: ev.message, ts: Date.now(), level: ev.level },
          ]);
          return;
        }
        if (ev.type === "error") {
          upsert((h) => [
            ...h,
            {
              id: uuid(),
              role: "system",
              text: `[${ev.code}] ${ev.message}`,
              ts: Date.now(),
              level: "error",
            },
          ]);
          return;
        }
        if (ev.type === "assistant_message") {
          upsert((h) => [
            ...h,
            { id: ev.message_id, role: "assistant", text: ev.text, ts: ev.ts ?? Date.now() },
          ]);
          return;
        }
        if (ev.type === "assistant_message_start") {
          upsert((h) => [
            ...h,
            { id: ev.message_id, role: "assistant", text: "", ts: ev.ts ?? Date.now(), streaming: true },
          ]);
          return;
        }
        if (ev.type === "assistant_message_delta") {
          upsert((h) => {
            const idx = h.findIndex((m) => m.id === ev.message_id && m.role === "assistant");
            if (idx < 0) {
              return [
                ...h,
                {
                  id: ev.message_id,
                  role: "assistant",
                  text: ev.delta,
                  ts: Date.now(),
                  streaming: true,
                },
              ];
            }
            const cur = h[idx] as Extract<ChatMessage, { role: "assistant" }>;
            const next = [...h];
            next[idx] = { ...cur, text: cur.text + ev.delta };
            return next;
          });
          return;
        }
        if (ev.type === "assistant_message_end") {
          upsert((h) => {
            const idx = h.findIndex((m) => m.id === ev.message_id && m.role === "assistant");
            if (idx < 0) return h;
            const cur = h[idx] as Extract<ChatMessage, { role: "assistant" }>;
            const next = [...h];
            next[idx] = { ...cur, streaming: false };
            return next;
          });
          return;
        }
        if (ev.type === "typing") {
          // could show a typing indicator; skip for MVP
          return;
        }
        return;
      }
      if (msg.kind === "tool_call_update") {
        const u = msg.update;
        upsert((h) => {
          const idx = h.findIndex((m) => m.role === "tool" && m.call_id === u.call_id);
          if (u.phase === "pending") {
            if (idx >= 0) return h;
            return [
              ...h,
              {
                id: uuid(),
                role: "tool",
                ts: u.ts,
                call_id: u.call_id,
                tool: u.tool,
                args: u.arguments,
                state: "pending",
              },
            ];
          }
          if (idx < 0) return h;
          const cur = h[idx] as Extract<ChatMessage, { role: "tool" }>;
          const next = [...h];
          if (u.phase === "running") next[idx] = { ...cur, state: "running" };
          else if (u.phase === "ok") next[idx] = { ...cur, state: "ok", summary: u.summary };
          else if (u.phase === "error") next[idx] = { ...cur, state: "error", error: u.error };
          else if (u.phase === "denied") next[idx] = { ...cur, state: "denied" };
          return next;
        });
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });

    return () => {
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    };
  }, [upsert]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [history]);

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const message_id = uuid();
      const has_context =
        contextOptions.url_title ||
        contextOptions.selection ||
        contextOptions.page ||
        contextOptions.screenshot;
      upsert((h) => [
        ...h,
        { id: message_id, role: "user", text, ts: Date.now(), has_context },
      ]);
      portRef.current?.postMessage({
        kind: "send_message",
        message_id,
        text,
        context_options: contextOptions,
      } satisfies SidepanelToBg);
    },
    [contextOptions, upsert],
  );

  const reconnect = useCallback(() => {
    portRef.current?.postMessage({ kind: "reconnect" } satisfies SidepanelToBg);
  }, []);

  const onClearHistory = useCallback(() => {
    if (!window.confirm("Clear all chat history in this client?")) return;
    void clearHistory().then(() => setHistory([]));
  }, []);

  const confirmTool = useCallback((call_id: string, approved: boolean) => {
    portRef.current?.postMessage({ kind: "confirm_tool", call_id, approved } satisfies SidepanelToBg);
  }, []);

  const openOptions = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  const needsSetup = useMemo(() => !settings?.endpoint, [settings]);

  return (
    <div className="flex flex-col h-full">
      <ConnectionBar
        state={conn.state}
        detail={conn.detail}
        onReconnect={reconnect}
        onSettings={openOptions}
        onClear={onClearHistory}
      />

      {needsSetup ? (
        <div className="m-3 p-3 border border-border rounded-md text-muted text-xs">
          <div className="text-fg font-semibold mb-1">Set up Hermes endpoint</div>
          Open <button onClick={openOptions} className="text-accent underline">Options</button> and enter your Hermes WebSocket URL (e.g. <code>wss://hermes.example.com/ws/browser</code>) plus a link token.
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll px-3 py-2 space-y-2">
        {history.length === 0 ? (
          <div className="text-muted text-center pt-12">
            Start chatting with your Hermes agent.
            <br />
            Use the chips below to attach page context.
          </div>
        ) : null}
        {history.map((m) =>
          m.role === "tool" ? (
            <ToolRow key={m.id} msg={m} onConfirm={confirmTool} />
          ) : (
            <MessageBubble key={m.id} msg={m} />
          ),
        )}
      </div>

      <Composer
        contextOptions={contextOptions}
        onContextChange={setContextOptions}
        onSend={send}
        disabled={conn.state !== "open"}
        disabledReason={conn.state}
      />
    </div>
  );
}
